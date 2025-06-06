import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import { ClaimField, Platform, TokenResponse } from '../models';
import { Result } from '../result';
import {
  encodeObject,
  getCallbackForPlatform,
  httpResponseToError,
} from '../utility';
import { OAuthVerifier } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

export type PatreonToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

type PatreonOAuthCallbackData = {
  code: string;
  state?: string;
};

export type PatreonOAuthURLResult = {
  url: string;
  token: string;
  secret: string;
};

class PatreonOAuthVerifier extends OAuthVerifier<PatreonOAuthCallbackData> {
  constructor() {
    super(Core.Models.ClaimType.ClaimTypePatreon);
  }

  public async getOAuthURL(): Promise<Result<string>> {
    if (
      process.env.PATREON_CLIENT_ID === undefined ||
      process.env.OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    try {
      const callbackUrl = getCallbackForPlatform(this.claimType);
      if (!callbackUrl) {
        return Result.errMsg('Could not determine callback URL for Patreon');
      }

      const scopes = ['identity'];

      const url = new URL('https://www.patreon.com/oauth2/authorize');
      url.searchParams.append('response_type', 'code');
      url.searchParams.append('client_id', process.env.PATREON_CLIENT_ID);
      url.searchParams.append('redirect_uri', callbackUrl);

      if (scopes.length > 0) {
        url.searchParams.append('scope', scopes.join(' '));
      }

      const stateToken = Math.random().toString(36).substring(2, 15);
      url.searchParams.append('state', stateToken);

      return Result.ok(url.toString());
    } catch (error: any) {
      console.error('Patreon OAuth URL generation error:', error);
      return Result.errMsg(`Patreon OAuth error: ${error.message}`);
    }
  }

  public async getToken(
    data: PatreonOAuthCallbackData,
  ): Promise<Result<TokenResponse>> {
    if (
      process.env.PATREON_CLIENT_ID === undefined ||
      process.env.PATREON_CLIENT_SECRET === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    if (!data.code) {
      console.error('getToken called with missing OAuth code:', data);
      return Result.errMsg(
        'Internal error: Missing required code for token exchange.',
      );
    }

    try {
      const callbackUrl = getCallbackForPlatform(this.claimType);
      if (!callbackUrl) {
        return Result.errMsg(
          'Could not determine callback URL for Patreon token exchange',
        );
      }

      const tokenResponse = await axios.post<PatreonToken>(
        'https://www.patreon.com/api/oauth2/token',
        new URLSearchParams({
          code: data.code,
          grant_type: 'authorization_code',
          client_id: process.env.PATREON_CLIENT_ID,
          client_secret: process.env.PATREON_CLIENT_SECRET,
          redirect_uri: callbackUrl,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const userResponse = await axios.get(
        'https://www.patreon.com/api/oauth2/v2/identity',
        {
          headers: {
            Authorization: `Bearer ${tokenResponse.data.access_token}`,
          },
          params: {
            'fields[user]': 'email,full_name,vanity',
          },
        },
      );

      const username =
        userResponse.data.data.attributes.vanity || userResponse.data.data.id;

      if (!username) {
        console.error(
          'Could not extract username (vanity or id) from Patreon identity response:',
          userResponse.data,
        );
        return Result.errMsg('Failed to retrieve username from Patreon.');
      }

      return Result.ok({
        username: String(username),
        token: encodeObject<PatreonToken>({
          access_token: tokenResponse.data.access_token,
          refresh_token: tokenResponse.data.refresh_token,
          expires_in: tokenResponse.data.expires_in,
          scope: tokenResponse.data.scope,
          token_type: tokenResponse.data.token_type,
        }),
      });
    } catch (err: any) {
      console.error(
        'Patreon API token exchange error:',
        err.response ? JSON.stringify(err.response.data) : err.message,
      );

      if (err.response) {
        if (err.response.data?.error === 'invalid_grant') {
          return Result.err({
            message: 'Invalid or expired authorization code.',
            extendedMessage:
              'Patreon rejected the authorization code. It might have expired or already been used.',
            statusCode: StatusCodes.BAD_REQUEST,
          });
        }
        return httpResponseToError(
          err.response.status,
          JSON.stringify(err.response.data),
          'Patreon API Token Exchange',
        );
      }

      return Result.err({
        message: 'Failed to exchange OAuth token with Patreon.',
        extendedMessage: err instanceof Error ? err.message : String(err),
        statusCode: StatusCodes.BAD_GATEWAY,
      });
    }
  }

  public async isTokenValid(
    challengeResponseBase64UrlEncoded: string,
    claimFields: ClaimField[],
  ): Promise<Result<void>> {
    if (
      process.env.PATREON_CLIENT_ID === undefined ||
      process.env.PATREON_CLIENT_SECRET === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    if (claimFields.length !== 1 || claimFields[0].key !== 0) {
      const msg = 'Invalid claim fields.';
      return Result.err({
        message: msg,
        extendedMessage: `Invalid claim fields ${JSON.stringify(claimFields)}`,
      });
    }

    let payload: PatreonToken;
    try {
      const base64Token = decodeURIComponent(challengeResponseBase64UrlEncoded);
      const jsonToken = Buffer.from(base64Token, 'base64').toString('utf8');
      payload = JSON.parse(jsonToken);
    } catch (e: any) {
      console.error(
        '[Patreon.isTokenValid] Failed to decode/parse challenge response:',
        e,
        'Input after decodeURIComponent:' /* base64Token could be logged here if needed */,
      );
      let errorMessage = 'Invalid token data format for Patreon verification.';
      if (e instanceof SyntaxError) {
        errorMessage = 'Invalid JSON format in Patreon token data.';
      } else if (
        e.message.includes('Invalid character') ||
        e.message.includes('base64')
      ) {
        errorMessage = 'Invalid Base64 encoding in Patreon token data.';
      }
      return Result.err({ message: errorMessage, extendedMessage: e.message });
    }

    if (!payload || !payload.access_token) {
      console.error(
        '[Patreon.isTokenValid] Decoded Patreon payload missing access_token:',
        payload,
      );
      return Result.err({
        message: 'Incomplete token data for Patreon verification.',
      });
    }

    const expectedUsername = claimFields[0].value;

    try {
      const userResponse = await axios.get(
        'https://www.patreon.com/api/oauth2/v2/identity',
        {
          headers: {
            Authorization: `Bearer ${payload.access_token}`,
          },
          params: {
            'fields[user]': 'vanity',
          },
        },
      );

      const actualUsername =
        userResponse.data.data.attributes.vanity || userResponse.data.data.id;

      if (!actualUsername) {
        console.error(
          '[Patreon.isTokenValid] Could not extract username (vanity or id) from Patreon identity response:',
          userResponse.data,
        );
        return Result.errMsg(
          'Failed to retrieve username from Patreon during validation.',
        );
      }

      if (
        String(actualUsername).toLowerCase() !== expectedUsername.toLowerCase()
      ) {
        return Result.err({
          message: "The username didn't match the account you logged in with",
          extendedMessage: `Username mismatch (expected: ${expectedUsername}, got: ${actualUsername})`,
        });
      }

      return Result.ok();
    } catch (err: any) {
      console.error(
        '[Patreon.isTokenValid] Patreon API verification error:',
        err.response ? JSON.stringify(err.response.data) : err.message,
      );

      if (err.response) {
        if (err.response.status === StatusCodes.UNAUTHORIZED) {
          return Result.err({
            message: 'Patreon token is invalid or expired.',
            extendedMessage:
              'Patreon rejected the access token during validation.',
            statusCode: StatusCodes.UNAUTHORIZED,
          });
        }
        return httpResponseToError(
          err.response.status,
          JSON.stringify(err.response.data),
          'Patreon API Verification',
        );
      }

      return Result.err({
        message: 'Failed to verify Patreon account',
        extendedMessage: err instanceof Error ? err.message : String(err),
        statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      });
    }
  }

  public async healthCheck(): Promise<Result<void>> {
    if (
      process.env.PATREON_CLIENT_ID === undefined ||
      process.env.PATREON_CLIENT_SECRET === undefined
    ) {
      return Result.errMsg(
        'Verifier not configured: Missing Patreon credentials',
      );
    }

    return Result.ok();
  }
}

export const Patreon: Platform = {
  name: 'Patreon',
  verifiers: [new PatreonOAuthVerifier()],
  version: 1,
};
