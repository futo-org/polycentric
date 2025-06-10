import {
  createCookieEnabledAxios,
  getCallbackForPlatform,
  httpResponseToError,
} from '../utility';
import { ClaimField, Platform, TokenResponse } from '../models';
import { Result } from '../result';
import qs from 'qs';
import { OAuthVerifier } from '../verifier';
import { StatusCodes } from 'http-status-codes';

import * as Core from '@polycentric/polycentric-core';

type SpotifyTokenRequest = {
  code: string;
};

class SpotifyOAuthVerifier extends OAuthVerifier<SpotifyTokenRequest> {
  constructor() {
    super(Core.Models.ClaimType.ClaimTypeSpotify);
  }

  public async getOAuthURL(finalRedirectUri: string): Promise<Result<string>> {
    if (
      process.env.SPOTIFY_CLIENT_ID === undefined ||
      process.env.OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    const redirectUri = getCallbackForPlatform(this.claimType, finalRedirectUri, true);
    return Result.ok(
      `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(
        process.env.SPOTIFY_CLIENT_ID,
      )}&redirect_uri=${redirectUri}`,
    );
  }

  public async getToken(
    data: SpotifyTokenRequest,
  ): Promise<Result<TokenResponse>> {
    if (
      process.env.SPOTIFY_CLIENT_ID === undefined ||
      process.env.SPOTIFY_CLIENT_SECRET === undefined ||
      process.env.OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    const redirectUri = getCallbackForPlatform(this.claimType, "");
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
          process.env.SPOTIFY_CLIENT_ID +
            ':' +
            process.env.SPOTIFY_CLIENT_SECRET,
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

  public healthCheck(): Promise<Result<void>> {
    throw new Error('Method not implemented.');
  }
}

export const Spotify: Platform = {
  name: 'Spotify',
  verifiers: [new SpotifyOAuthVerifier()],
  version: 1,
};
