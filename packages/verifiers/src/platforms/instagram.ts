import { ClaimField, Platform, TokenResponse } from '../models';
import {
  createCookieEnabledAxios,
  getCallbackForPlatform,
  httpResponseToError,
} from '../utility';
import { Result } from '../result';
import { StatusCodes } from 'http-status-codes';
import { OAuthVerifier } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

type InstagramTokenRequest = {
  code: string;
};

class InstagramOAuthVerifier extends OAuthVerifier<InstagramTokenRequest> {
  constructor() {
    super(Core.Models.ClaimType.ClaimTypeInstagram);
  }

  public async getOAuthURL(finalRedirectUri: string): Promise<Result<string>> {
    if (
      process.env.INSTAGRAM_CLIENT_ID === undefined ||
      process.env.OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    } else {
      const redirectUri = getCallbackForPlatform(
        this.claimType,
        finalRedirectUri,
        true,
      );
      return Result.ok(
        `https://api.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=user_profile`,
      );
    }
  }

  public async getToken(
    data: InstagramTokenRequest,
  ): Promise<Result<TokenResponse>> {
    if (
      process.env.INSTAGRAM_CLIENT_ID === undefined ||
      process.env.INSTAGRAM_CLIENT_SECRET === undefined ||
      process.env.OAUTH_CALLBACK_DOMAIN === undefined
    ) {
      return Result.errMsg('Verifier not configured');
    }

    const redirectUri = getCallbackForPlatform(this.claimType, '');
    const client = createCookieEnabledAxios();
    const form = new FormData();
    form.append('client_id', process.env.INSTAGRAM_CLIENT_ID);
    form.append('client_secret', process.env.INSTAGRAM_CLIENT_SECRET);
    form.append('grant_type', 'authorization_code');
    form.append('redirect_uri', redirectUri);
    form.append('code', data.code);
    const tokenResponse = await client.post(
      'https://api.instagram.com/oauth/access_token',
      form,
    );

    if (tokenResponse.status !== StatusCodes.OK) {
      return httpResponseToError(
        tokenResponse.status,
        tokenResponse.data,
        'Instagram API /oauth/access_token',
      );
    }

    const accessToken = tokenResponse.data['access_token'];
    const response = await client.get('https://graph.instagram.com/v17.0/me', {
      params: {
        fields: 'username',
        access_token: accessToken,
      },
    });

    if (response.status === StatusCodes.OK) {
      return Result.ok({
        username: response.data.username,
        token: accessToken,
      });
    }

    return httpResponseToError(
      response.status,
      response.data,
      'Instagram API /me',
    );
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
    const response = await client.get('https://graph.instagram.com/v17.0/me', {
      params: {
        fields: 'username',
        access_token: challengeResponse,
      },
    });

    if (response.data.username !== id) {
      return Result.err({
        message: "The username didn't match the account you logged in with",
        extendedMessage: `Username did not match (expected: ${id}, got: ${response.data.username})`,
      });
    }

    return Result.ok();
  }

  public healthCheck(): Promise<Result<void>> {
    throw new Error('Method not implemented.');
  }

  public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
    const match = /https:\/\/(?:www\.)?instagram\.com\/([^/]+)\/?/.exec(url);
    if (!match) {
      return Result.err({ message: 'Failed to match regex' });
    }

    return Result.ok([
      {
        key: 0,
        value: match[1],
      },
    ]);
  }
}

export const Instagram: Platform = {
  name: 'Instagram',
  verifiers: [new InstagramOAuthVerifier() /*, new InstagramTextVerifier()*/],
  version: 1,
};
