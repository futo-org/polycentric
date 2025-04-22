import { StatusCodes } from 'http-status-codes';
import TwitterApi, { ApiResponseError } from 'twitter-api-v2';
import { ClaimField, Platform, TokenResponse } from '../models';
import { Result } from '../result';
import { decodeObject, encodeObject, getCallbackForPlatform, httpResponseToError } from '../utility';
import { OAuthVerifier } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

export type XToken = {
    secret: string;
    token: string;
};

type XOAuthCallbackData = {
    oauth_token: string;
    oauth_verifier: string;
    secret: string;
};

export type XOAuthURLResult = {
    url: string;
    token: string;
    secret: string;
};

class XOAuthVerifier extends OAuthVerifier<XOAuthCallbackData> {
    constructor() {
        super(Core.Models.ClaimType.ClaimTypeTwitter);
    }

    public async getOAuthURL(): Promise<Result<XOAuthURLResult>> {
        if (
            process.env.X_API_KEY === undefined ||
            process.env.X_API_SECRET === undefined ||
            process.env.OAUTH_CALLBACK_DOMAIN === undefined
        ) {
            return Result.errMsg('Verifier not configured');
        }

        try {
            const client = new TwitterApi({
                appKey: process.env.X_API_KEY,
                appSecret: process.env.X_API_SECRET,
            });

            const callbackUrl = getCallbackForPlatform(this.claimType);
            const oauthRequest = await client.generateAuthLink(callbackUrl, { linkMode: 'authorize' });

            if (!oauthRequest.oauth_callback_confirmed) {
                 console.error('OAuth callback not confirmed by Twitter/X API.');
                 return Result.errMsg('Failed to initiate OAuth flow: Callback not confirmed by provider.');
            }

            return Result.ok({
                url: oauthRequest.url,
                token: oauthRequest.oauth_token,
                secret: oauthRequest.oauth_token_secret,
            });
        } catch (error: any) {
            console.error('Twitter API error generating auth link:', error);
             if (error instanceof ApiResponseError) {
                 return httpResponseToError(error.code, JSON.stringify(error.data), 'X API Auth Link Generation');
             }
            return Result.errMsg(`Twitter API error: ${error.message}`);
        }
    }

    public async getToken(data: XOAuthCallbackData): Promise<Result<TokenResponse>> {
        if (process.env.X_API_KEY === undefined || process.env.X_API_SECRET === undefined) {
            return Result.errMsg('Verifier not configured');
        }

        if (!data.oauth_token || !data.oauth_verifier || !data.secret) {
             console.error('getToken called with missing OAuth data:', data);
             return Result.errMsg('Internal error: Missing required data for token exchange.');
        }

        try {
            const client = new TwitterApi({
                appKey: process.env.X_API_KEY!,
                appSecret: process.env.X_API_SECRET!,
                accessToken: data.oauth_token, // Request token
                accessSecret: data.secret,     // Request token secret
            });

            const response = await client.login(data.oauth_verifier);

            return Result.ok({
                username: response.screenName,
                token: encodeObject<XToken>({
                    secret: response.accessSecret,
                    token: response.accessToken,
                }),
            });
        } catch (err) {
            console.error('X API login/token exchange error:', err);
            if (err instanceof ApiResponseError) {
                return httpResponseToError(err.code, JSON.stringify(err.data), 'X API Login/Token Exchange');
            }
            return Result.err({
                 message: 'Failed to exchange OAuth token with X.',
                 extendedMessage: err instanceof Error ? err.message : String(err),
                 statusCode: StatusCodes.BAD_GATEWAY // Or appropriate error code
            });
        }
    }

    public async isTokenValid(challengeResponseBase64: string, claimFields: ClaimField[]): Promise<Result<void>> {
        if (process.env.X_API_KEY === undefined || process.env.X_API_SECRET === undefined) {
            return Result.errMsg('Verifier not configured');
        }

        if (claimFields.length !== 1 || claimFields[0].key !== 0) {
            const msg = 'Invalid claim fields.';
            return Result.err({ message: msg, extendedMessage: `Invalid claim fields ${JSON.stringify(claimFields)}` });
        }

        let payload: XToken;
        try {
            const decoded = decodeURIComponent(challengeResponseBase64);
            payload = decodeObject<XToken>(decoded);
        } catch (e) {
            console.error("[X.isTokenValid] Failed to decode challenge response object:", challengeResponseBase64, e);
            return Result.err({message: "Invalid token data format for X verification."});
        }

        if (!payload || !payload.token || !payload.secret) {
            console.error("[X.isTokenValid] Decoded X payload missing token or secret:", payload);
            return Result.err({message: "Incomplete token data for X verification."});
        }

        const id = claimFields[0].value;

        console.log('[isTokenValid] Decoded XToken payload:', {
            tokenStart: payload.token?.substring(0, 5),
            tokenEnd: payload.token?.slice(-4),
            secretStart: payload.secret?.substring(0, 5),
            secretEnd: payload.secret?.slice(-4),
        });
        console.log('[isTokenValid] ENV Check:', {
            key_exists: !!process.env.X_API_KEY,
            key_suffix: process.env.X_API_KEY?.slice(-4),
            secret_exists: !!process.env.X_API_SECRET,
        });

        const client = new TwitterApi({
            appKey: process.env.X_API_KEY!,
            appSecret: process.env.X_API_SECRET!,
            accessToken: payload.token,
            accessSecret: payload.secret,
        });

        try {
            console.log('[isTokenValid] Calling client.currentUser()');
            const response = await client.currentUser();
            const res = response.screen_name;
            if (res !== id) {
                return Result.err({
                    message: "The username didn't match the account you logged in with",
                    extendedMessage: `Username did not match (expected: ${id}, got: ${response.screen_name})`,
                });
            }
            return Result.ok();
        } catch (err) {
            console.error('[X.isTokenValid] X API verification error:', err);
            if (err instanceof ApiResponseError) {
                 console.error('[X.isTokenValid] X API ApiResponseError details:', { code: err.code, data: err.data });
                return httpResponseToError(err.code, JSON.stringify(err.data), 'X API Verification');
            }
            return Result.err({
                message: 'Failed to verify X account',
                extendedMessage: err instanceof Error ? err.message : String(err),
            });
        }
    }

    public healthCheck(): Promise<Result<void>> {
        throw new Error('Method not implemented.');
    }
}

export const X: Platform = {
    name: 'X',
    verifiers: [new XOAuthVerifier()],
    version: 1,
};
