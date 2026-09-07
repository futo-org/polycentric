import {
  createCookieEnabledAxios,
  getCallbackForPlatform,
  httpResponseToError,
} from '../utility.js';
import type { ClaimField, Platform, TokenResponse } from '../models.js';
import { Result } from '../result.js';
import qs from 'qs';
import { OAuthVerifier } from '../verifier.js';
import { StatusCodes } from 'http-status-codes';

type SpotifyTokenRequest = {
  code: string;
};

class SpotifyOAuthVerifier extends OAuthVerifier<SpotifyTokenRequest> {
  constructor() {
    super('Spotify');
  }

  public async getOAuthURL(): Promise<Result<string>> {
    if (
      process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_ID === undefined ||
      process.env.POLYCENTRIC_VERIFIER_BOT_OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    const redirectUri = getCallbackForPlatform(this.platform, true);
    return Result.ok(
      `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(
        process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_ID,
      )}&redirect_uri=${redirectUri}`,
    );
  }

  public async getToken(
    data: SpotifyTokenRequest,
  ): Promise<Result<TokenResponse>> {
    if (
      process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_ID === undefined ||
      process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_SECRET ===
        undefined ||
      process.env.POLYCENTRIC_VERIFIER_BOT_OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    const redirectUri = getCallbackForPlatform(this.platform);
    const client = createCookieEnabledAxios();
    const fdata = {
      code: data.code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    };
    const result = await client({
      url: 'https://accounts.spotify.com/api/token',
      method: 'POST',
      data: qs.stringify(fdata),
      headers: {
        Authorization: `Basic ${Buffer.from(
          process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_ID +
            ':' +
            process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_SECRET,
        ).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    if (result.status !== StatusCodes.OK) {
      return httpResponseToError(
        result.status,
        result.data,
        'Spotify API /api/token',
      );
    }

    const token = result.data['access_token'];

    const usernameResponse = await client.get('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (usernameResponse.status !== StatusCodes.OK) {
      return httpResponseToError(
        usernameResponse.status,
        usernameResponse.data,
        'Spotify API /v1/me',
      );
    }

    return Result.ok({
      token: result.data.access_token,
      username: usernameResponse.data.display_name,
    });
  }

  public async isTokenValid(
    challengeResponse: string,
    claimFields: ClaimField[],
  ): Promise<Result<void>> {
    if (claimFields.length !== 1 || claimFields[0].key !== 0) {
      const msg = 'Invalid claim fields.';
      return Result.err({
        message: msg,
        extendedMessage: `Invalid claim fields ${JSON.stringify(claimFields)}`,
      });
    }

    const id = claimFields[0].value;
    const client = createCookieEnabledAxios();
    const response = await client.get('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${challengeResponse}`,
      },
    });

    if (response.status !== StatusCodes.OK) {
      return httpResponseToError(
        response.status,
        response.data,
        'Spotify API /v1/me',
      );
    }

    const res = response.data.display_name;
    if (res !== id) {
      return Result.err({
        message: "The username didn't match the account you logged in with",
        extendedMessage: `Username did not match (expected: ${id}, got: ${response.data.display_name})`,
      });
    }

    return Result.ok();
  }

  public async healthCheck(): Promise<Result<void>> {
    if (
      process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_ID === undefined ||
      process.env.POLYCENTRIC_VERIFIER_BOT_SPOTIFY_CLIENT_SECRET === undefined
    ) {
      return Result.errMsg(
        'Verifier not configured: Missing Spotify credentials',
      );
    }

    return Result.ok();
  }
}

export const Spotify: Platform = {
  name: 'Spotify',
  verifiers: [new SpotifyOAuthVerifier()],
  version: 1,
};
