import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import { ClaimField, Platform, TokenResponse } from '../models';
import { Result } from '../result';
import { encodeObject, getCallbackForPlatform, httpResponseToError } from '../utility';
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

    public async getOAuthURL(): Promise<Result<PatreonOAuthURLResult>> {
        if (
            process.env.PATREON_CLIENT_ID === undefined ||
            process.env.OAUTH_CALLBACK_DOMAIN === undefined
        ) {
            return Result.errMsg('Verifier not configured');
        }

        try {
            const callbackUrl = getCallbackForPlatform(this.claimType);
            
            // Optional scope parameter can be added if needed
            const scopes = ['identity']; // Most basic scope to get user info
            
            const url = new URL('https://www.patreon.com/oauth2/authorize');
            url.searchParams.append('response_type', 'code');
            url.searchParams.append('client_id', process.env.PATREON_CLIENT_ID);
            url.searchParams.append('redirect_uri', callbackUrl);
            
            if (scopes.length > 0) {
                url.searchParams.append('scope', scopes.join(' '));
            }
            
            // Create a state token that will be used as both token and secret
            const stateToken = Math.random().toString(36).substring(2, 15);
            url.searchParams.append('state', stateToken);

            return Result.ok({
                url: url.toString(),
                token: stateToken,  // Use state as token
                secret: stateToken, // Use state as secret (not actually used for OAuth 2.0)
            });
        } catch (error: any) {
            console.error('Patreon OAuth URL generation error:', error);
            return Result.errMsg(`Patreon OAuth error: ${error.message}`);
        }
    }

    public async getToken(data: PatreonOAuthCallbackData): Promise<Result<TokenResponse>> {
        if (
            process.env.PATREON_CLIENT_ID === undefined || 
            process.env.PATREON_CLIENT_SECRET === undefined
        ) {
            return Result.errMsg('Verifier not configured');
        }

        if (!data.code) {
            console.error('getToken called with missing OAuth code:', data);
            return Result.errMsg('Internal error: Missing required data for token exchange.');
        }

        try {
            const callbackUrl = getCallbackForPlatform(this.claimType);
            
            // Exchange the authorization code for an access token
            const tokenResponse = await axios.post(
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
                }
            );

            // Get user's identity information
            const userResponse = await axios.get(
                'https://www.patreon.com/api/oauth2/v2/identity',
                {
                    headers: {
                        Authorization: `Bearer ${tokenResponse.data.access_token}`,
                    },
                    params: {
                        'fields[user]': 'email,full_name,vanity',
                    },
                }
            );

            // The vanity field is the username used in Patreon URLs
            const username = userResponse.data.data.attributes.vanity || 
                             userResponse.data.data.id; // Fallback to user ID if vanity is not available

            return Result.ok({
                username,
                token: encodeObject<PatreonToken>({
                    access_token: tokenResponse.data.access_token,
                    refresh_token: tokenResponse.data.refresh_token,
                    expires_in: tokenResponse.data.expires_in,
                    scope: tokenResponse.data.scope,
                    token_type: tokenResponse.data.token_type,
                }),
            });
        } catch (err: any) {
            console.error('Patreon API token exchange error:', err);
            
            if (err.response) {
                return httpResponseToError(
                    err.response.status,
                    JSON.stringify(err.response.data),
                    'Patreon API Token Exchange'
                );
            }
            
            return Result.err({
                message: 'Failed to exchange OAuth token with Patreon.',
                extendedMessage: err instanceof Error ? err.message : String(err),
                statusCode: StatusCodes.BAD_GATEWAY
            });
        }
    }

    public async isTokenValid(challengeResponseBase64: string, claimFields: ClaimField[]): Promise<Result<void>> {
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
                extendedMessage: `Invalid claim fields ${JSON.stringify(claimFields)}` 
            });
        }

        let payload: PatreonToken;
        try {
            // First, URL decode the string if needed
            const decoded = decodeURIComponent(challengeResponseBase64);
            payload = JSON.parse(Buffer.from(decoded, 'base64').toString());
        } catch (e) {
            console.error("[Patreon.isTokenValid] Failed to decode challenge response:", e);
            return Result.err({message: "Invalid token data format for Patreon verification."});
        }

        if (!payload || !payload.access_token) {
            console.error("[Patreon.isTokenValid] Decoded Patreon payload missing access_token:", payload);
            return Result.err({message: "Incomplete token data for Patreon verification."});
        }

        const username = claimFields[0].value;

        try {
            // Verify the token by getting user info
            const userResponse = await axios.get(
                'https://www.patreon.com/api/oauth2/v2/identity',
                {
                    headers: {
                        Authorization: `Bearer ${payload.access_token}`,
                    },
                    params: {
                        'fields[user]': 'email,full_name,vanity',
                    },
                }
            );

            const userVanity = userResponse.data.data.attributes.vanity || 
                               userResponse.data.data.id;

            if (userVanity.toLowerCase() !== username.toLowerCase()) {
                return Result.err({
                    message: "The username didn't match the account you logged in with",
                    extendedMessage: `Username did not match (expected: ${username}, got: ${userVanity})`,
                });
            }
            
            return Result.ok();
        } catch (err: any) {
            console.error('[Patreon.isTokenValid] Patreon API verification error:', err);
            
            if (err.response) {
                return httpResponseToError(
                    err.response.status,
                    JSON.stringify(err.response.data),
                    'Patreon API Verification'
                );
            }
            
            return Result.err({
                message: 'Failed to verify Patreon account',
                extendedMessage: err instanceof Error ? err.message : String(err),
            });
        }
    }

    public async healthCheck(): Promise<Result<void>> {
        if (
            process.env.PATREON_CLIENT_ID === undefined || 
            process.env.PATREON_CLIENT_SECRET === undefined
        ) {
            return Result.errMsg('Verifier not configured: Missing Patreon credentials');
        }
        
        return Result.ok();
    }
}

export const Patreon: Platform = {
    name: 'Patreon',
    verifiers: [new PatreonOAuthVerifier()],
    version: 1,
};
