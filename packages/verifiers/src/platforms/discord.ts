import { StatusCodes } from 'http-status-codes';
import { ClaimField, Platform, TokenResponse } from '../models';
import { Result } from '../result';
import {
  createCookieEnabledAxios,
  encodeObject,
  getCallbackForPlatform,
  httpResponseToError,
} from '../utility';
import { OAuthVerifier } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

export type DiscordToken = {
  token: string;
};

type DiscordTokenRequest = {
  code: string;
  harborSecret?: string;
};

class DiscordOAuthVerifier extends OAuthVerifier<DiscordTokenRequest> {
  constructor() {
    super(Core.Models.ClaimType.ClaimTypeDiscord);
    this.tokenCache = new Map<string, TokenResponse>();
    this.usernameCache = new Map<string, string>();
  }

  public async getOAuthURL(finalRedirectUri: string): Promise<Result<string>> {
    if (
      process.env.DISCORD_CLIENT_ID === undefined ||
      process.env.OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    } else {
      const redirectUri = getCallbackForPlatform(
        this.claimType,
        finalRedirectUri,
        true,
      );

      const harborSecret = Math.random().toString(36).substring(2, 15);

      return Result.ok(
        `https://discord.com/api/oauth2/authorize?client_id=${
          process.env.DISCORD_CLIENT_ID
        }&redirect_uri=${redirectUri}&response_type=code&scope=identify&state=${encodeURIComponent(
          JSON.stringify({ harborSecret }),
        )}`,
      );
    }
  }

  public async getToken(
    data: DiscordTokenRequest,
  ): Promise<Result<TokenResponse>> {
    if (
      process.env.DISCORD_CLIENT_ID === undefined ||
      process.env.DISCORD_CLIENT_SECRET === undefined ||
      process.env.OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    try {
      if (!data.code) {
        console.error('Missing code parameter for Discord OAuth');
        return Result.err({
          message: 'Missing required OAuth parameters',
          extendedMessage: 'The code parameter is required for Discord OAuth',
        });
      }

      const cacheKey = `discord_token_${data.code}`;
      const cachedResponse = this.tokenCache.get(cacheKey);

      const redirectUri = getCallbackForPlatform(this.claimType, '');
      const client = createCookieEnabledAxios();

      try {
        const resp = await client.post(
          'https://discord.com/api/oauth2/token',
          new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code: data.code,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        );

        if (!resp.data || !resp.data.access_token) {
          console.error('No access token received from Discord');
          return Result.err({
            message: 'Failed to obtain access token',
            extendedMessage: 'Discord did not return an access token',
          });
        }

        const token = resp.data.access_token;
        const discordResponse = await client.get(
          'https://discord.com/api/users/@me',
          {
            headers: {
              Authorization: 'Bearer ' + token,
            },
          },
        );

        if (discordResponse.status === StatusCodes.OK) {
          const user = discordResponse.data;
          const hasDiscriminator =
            user.discriminator !== undefined && user.discriminator !== '0';
          const expectedUsername = hasDiscriminator
            ? `${user.username}#${user.discriminator}`
            : user.username;

          this.usernameCache.set(data.code, expectedUsername);

          const tokenObj: DiscordToken = { token };
          const encodedToken = encodeObject(tokenObj);

          const tokenResponse: TokenResponse = {
            username: expectedUsername,
            token: encodedToken,
          };

          this.tokenCache.set(cacheKey, tokenResponse);

          return Result.ok(tokenResponse);
        }

        return httpResponseToError(
          discordResponse.status,
          discordResponse.data,
          'Discord API /users/@me',
        );
      } catch (apiError: any) {
        if (apiError.response?.data?.error === 'invalid_grant') {
          const cachedUsername = this.usernameCache.get(data.code);
          if (cachedUsername) {
            const tokenResponse: TokenResponse = {
              username: cachedUsername,
              token: encodeObject<DiscordToken>({ token: 'cached_token' }),
            };

            this.tokenCache.set(cacheKey, tokenResponse);

            return Result.ok(tokenResponse);
          }

          return Result.err({
            message:
              'Discord authorization code has expired or already been used',
            extendedMessage: 'Please try the verification process again',
          });
        }

        throw apiError;
      }
    } catch (err: any) {
      console.error('Discord token error:', err);
      if (err.response) {
        return httpResponseToError(
          err.response.status,
          JSON.stringify(err.response.data),
          'Discord API token endpoint',
        );
      }

      return Result.err({
        message: 'Discord authentication failed',
        extendedMessage: err.message,
      });
    }
  }

  public async isTokenValid(
    challengeResponseUrlEncodedBase64: string,
    claimFields: ClaimField[],
  ): Promise<Result<void>> {
    if (claimFields.length !== 1 || claimFields[0].key !== 0) {
      const msg = 'Invalid claim fields.';
      return Result.err({
        message: msg,
        extendedMessage: `Invalid claim fields ${JSON.stringify(claimFields)}`,
      });
    }

    let payload: DiscordToken;
    try {
      const base64Token = decodeURIComponent(challengeResponseUrlEncodedBase64);
      const jsonToken = Buffer.from(base64Token, 'base64').toString('utf8');
      payload = JSON.parse(jsonToken);
    } catch (e: any) {
      console.error(
        '[Discord.isTokenValid] Failed to decode/parse challenge response:',
        e,
      );
      return Result.err({
        message: 'Invalid token data format for Discord verification.',
      });
    }
    if (!payload || !payload.token) {
      console.error(
        '[Discord.isTokenValid] Decoded Discord payload missing token:',
        payload,
      );
      return Result.err({
        message: 'Incomplete token data for Discord verification.',
      });
    }

    const expectedClaimUsername = claimFields[0].value;

    try {
      const client = createCookieEnabledAxios();

      const response = await client.get('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${payload.token}`,
        },
      });

      const user = response.data;
      const hasDiscriminator =
        user.discriminator !== undefined && user.discriminator !== '0';
      const actualDiscordUsername = hasDiscriminator
        ? `${user.username}#${user.discriminator}`
        : user.username;

      if (
        expectedClaimUsername.toLowerCase() !==
        actualDiscordUsername.toLowerCase()
      ) {
        return Result.err({
          message: "The username didn't match the account you logged in with",
          extendedMessage: `Username mismatch (expected: ${expectedClaimUsername}, got: ${actualDiscordUsername})`,
        });
      }

      return Result.ok();
    } catch (err: any) {
      console.error(
        '[Discord.isTokenValid] Discord API verification error:',
        err.response ? JSON.stringify(err.response.data) : err.message,
      );
      if (err.response) {
        if (err.response.status === StatusCodes.UNAUTHORIZED) {
          return Result.err({
            message: 'Discord token is invalid or expired.',
            extendedMessage:
              'Discord rejected the access token during validation.',
            statusCode: StatusCodes.UNAUTHORIZED,
          });
        }
        return httpResponseToError(
          err.response.status,
          JSON.stringify(err.response.data),
          'Discord API /users/@me Verification',
        );
      }
      return Result.err({
        message: 'Failed to verify Discord account via API',
        extendedMessage: err instanceof Error ? err.message : String(err),
        statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      });
    }
  }

  public healthCheck(): Promise<Result<void>> {
    throw new Error('Method not implemented.');
  }

  private tokenCache = new Map<string, TokenResponse>();
  private usernameCache = new Map<string, string>();
}

export const Discord: Platform = {
  name: 'Discord',
  verifiers: [new DiscordOAuthVerifier()],
  version: 1,
};
