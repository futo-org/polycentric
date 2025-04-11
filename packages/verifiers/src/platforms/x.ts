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

type XTokenRequest = {
    oauth_token: string;
    oauth_verifier: string;
    harborSecret: string;
};

class XOAuthVerifier extends OAuthVerifier<XTokenRequest> {
    constructor() {
        super(Core.Models.ClaimType.ClaimTypeTwitter);
    }

    public async getOAuthURL(): Promise<Result<string>> {
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

            const oauthRequest = await client.generateAuthLink(getCallbackForPlatform(this.claimType));
            return Result.ok(`${oauthRequest.url}&harborSecret=${oauthRequest.oauth_token_secret}`);
        } catch (error: any) {
            console.error('Twitter API error:', error);
            return Result.errMsg(`Twitter API error: ${error.message}`);
        }
    }

    public async getToken(data: XTokenRequest): Promise<Result<TokenResponse>> {
        if (process.env.X_API_KEY === undefined || process.env.X_API_SECRET === undefined) {
            return Result.errMsg('Verifier not configured');
        }

        // Add checks for required parameters from the frontend/callback
        if (!data.oauth_token) {
            console.error("getToken called with missing oauth_token");
            return Result.errMsg("Missing OAuth token in request data");
        }
        if (!data.oauth_verifier) {
            console.error("getToken called with missing oauth_verifier");
            return Result.errMsg("Missing OAuth verifier in request data");
        }
        // Ensure the oauth_token_secret (passed as harborSecret) is present
        if (!data.harborSecret) {
            console.error("getToken called with missing harborSecret (OAuth token secret)");
            return Result.errMsg("Missing OAuth token secret (harborSecret) in request data");
        }

        try {
            // Retrieve stored oauth_token_secret
            const oauth_token_secret = data.harborSecret;

            // Log the tokens being used (consider masking secrets in production logs if necessary)
            console.log(`Attempting X login with oauth_token: ${data.oauth_token}, oauth_verifier: ${data.oauth_verifier}, oauth_token_secret: ${oauth_token_secret ? 'present' : 'missing'}`);

            // Initialize TwitterApi with app credentials and the REQUEST token/secret
            const requestClient = new TwitterApi({
                appKey: process.env.X_API_KEY,
                appSecret: process.env.X_API_SECRET,
                accessToken: data.oauth_token, // This is the request token
                accessSecret: oauth_token_secret, // This is the request token secret
            });

            // Exchange request token for access token using the oauth_verifier
            const { accessToken, accessSecret, screenName } = await requestClient.login(data.oauth_verifier);

            // Successfully obtained access token and secret
            return Result.ok({
                username: screenName,
                token: encodeObject<XToken>({
                    secret: accessSecret, // Store the ACCESS secret
                    token: accessToken, // Store the ACCESS token
                }),
            });
        } catch (err) {
            console.error("Error during X API login:", err); // Log the raw error

            if (err instanceof ApiResponseError) {
                // Log specific details from the API response error
                console.error(`X API Response Error: Status=${err.code}, Data=${JSON.stringify(err.data)}`);
                const errorMessage = `Returned ${err.code} on X API Login endpoint with content: ${JSON.stringify(err.data)}`;
                // Return a structured error
                return Result.err({
                    message: "Verifier was unable to validate your login information with X",
                    extendedMessage: errorMessage,
                });
            }

            // Handle other types of errors (network issues, etc.)
            const extendedMessage = err instanceof Error ? err.message : String(err);
            console.error("Unexpected error during X login:", extendedMessage);
            return Result.err({
                message: "An unexpected error occurred during X verification",
                extendedMessage: extendedMessage,
            });
        }
    }

    public async isTokenValid(challengeResponse: string, claimFields: ClaimField[]): Promise<Result<void>> {
        if (process.env.X_API_KEY === undefined || process.env.X_API_SECRET === undefined) {
            return Result.errMsg('Verifier not configured');
        }

        if (claimFields.length !== 1 || claimFields[0].key !== 0) {
            const msg = 'Invalid claim fields.';
            return Result.err({ message: msg, extendedMessage: `Invalid claim fields ${JSON.stringify(claimFields)}` });
        }

        const payload = decodeObject<XToken>(challengeResponse);
        const id = claimFields[0].value;

        const client = new TwitterApi({
            appKey: process.env.X_API_KEY,
            appSecret: process.env.X_API_SECRET,
            accessToken: payload.token,
            accessSecret: payload.secret,
        });

        try {
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
            if (err instanceof ApiResponseError) {
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
