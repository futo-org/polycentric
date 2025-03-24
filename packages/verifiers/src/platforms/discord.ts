import { StatusCodes } from 'http-status-codes';
import { ClaimField, Platform, TokenResponse } from '../models';
import { Result } from '../result';
import { createCookieEnabledAxios, encodeObject, getCallbackForPlatform, httpResponseToError } from '../utility';
import { OAuthVerifier } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

export type DiscordToken = {
    token: string;
};

type DiscordTokenRequest = {
    code: string;
    harborSecret?: string; // Add harborSecret to match X implementation
};

class DiscordOAuthVerifier extends OAuthVerifier<DiscordTokenRequest> {
    constructor() {
        super(Core.Models.ClaimType.ClaimTypeDiscord);
        this.tokenCache = new Map<string, TokenResponse>();
        this.usernameCache = new Map<string, string>();
    }

    public async getOAuthURL(): Promise<Result<string>> {
        if (process.env.DISCORD_CLIENT_ID === undefined || process.env.OAUTH_CALLBACK_DOMAIN === undefined) {
            return Result.errMsg('Verifier not configured');
        } else {
            const redirectUri = getCallbackForPlatform(this.claimType, true);
            
            // Generate a random state value to use as harborSecret
            const harborSecret = Math.random().toString(36).substring(2, 15);
            
            // Add state parameter with harborSecret
            return Result.ok(
                `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify&state=${encodeURIComponent(JSON.stringify({ harborSecret }))}`
            );
        }
    }

    public async getToken(data: DiscordTokenRequest): Promise<Result<TokenResponse>> {
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
                    extendedMessage: 'The code parameter is required for Discord OAuth'
                });
            }

            // Check if we already have a cached token for this code
            const cacheKey = `discord_token_${data.code}`;
            const cachedResponse = this.tokenCache.get(cacheKey);

            const redirectUri = getCallbackForPlatform(this.claimType);
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
                    }
                );

                if (!resp.data || !resp.data.access_token) {
                    console.error('No access token received from Discord');
                    return Result.err({
                        message: 'Failed to obtain access token',
                        extendedMessage: 'Discord did not return an access token'
                    });
                }

                const token = resp.data.access_token;
                const discordResponse = await client.get('https://discord.com/api/users/@me', {
                    headers: {
                        Authorization: 'Bearer ' + token,
                    },
                });

                if (discordResponse.status === StatusCodes.OK) {
                    const user = discordResponse.data;
                    const hasDiscriminator = user.discriminator !== undefined && user.discriminator !== '0';
                    const expectedUsername = hasDiscriminator ? `${user.username}#${user.discriminator}` : user.username;
                    
                    // Store username in cache
                    this.usernameCache.set(data.code, expectedUsername);
                    
                    // Create a simple token object and encode it properly
                    const tokenObj: DiscordToken = { token };
                    const encodedToken = encodeObject(tokenObj);
                    
                    // Create the token response
                    const tokenResponse: TokenResponse = { 
                        username: expectedUsername, 
                        token: encodedToken
                    };
                    
                    // Cache the response
                    this.tokenCache.set(cacheKey, tokenResponse);
                    
                    return Result.ok(tokenResponse);
                }

                return httpResponseToError(discordResponse.status, discordResponse.data, 'Discord API /users/@me');
            } catch (apiError: any) {
                // Check if this is an "invalid_grant" error (code already used)
                if (apiError.response?.data?.error === 'invalid_grant') {
                    // If we have a cached username from a previous successful request, return it
                    const cachedUsername = this.usernameCache.get(data.code);
                    if (cachedUsername) {
                        const tokenResponse: TokenResponse = {
                            username: cachedUsername,
                            token: encodeObject<DiscordToken>({ token: 'cached_token' })
                        };
                        
                        // Cache the response
                        this.tokenCache.set(cacheKey, tokenResponse);
                        
                        return Result.ok(tokenResponse);
                    }
                    
                    return Result.err({
                        message: 'Discord authorization code has expired or already been used',
                        extendedMessage: 'Please try the verification process again'
                    });
                }
                
                throw apiError; // Re-throw for the outer catch block to handle
            }
        } catch (err: any) {
            console.error('Discord token error:', err);
            if (err.response) {
                return httpResponseToError(
                    err.response.status, 
                    JSON.stringify(err.response.data), 
                    'Discord API token endpoint'
                );
            }
            
            return Result.err({
                message: 'Discord authentication failed',
                extendedMessage: err.message
            });
        }
    }

    public async isTokenValid(challengeResponse: string, claimFields: ClaimField[]): Promise<Result<void>> {
        if (claimFields.length !== 1 || claimFields[0].key !== 0) {
            const msg = 'Invalid claim fields.';
            return Result.err({ message: msg, extendedMessage: `Invalid claim fields ${JSON.stringify(claimFields)}` });
        }
        
        try {
            // Try to parse the challenge as JSON directly
            try {
                const oauthData = JSON.parse(challengeResponse);
                
                if (oauthData.code) {
                    // Check if we have a cached username for this code
                    const cachedUsername = this.usernameCache.get(oauthData.code);
                    if (cachedUsername) {
                        const username = claimFields[0].value;
                        
                        if (username !== cachedUsername) {
                            return Result.err({
                                message: "The username didn't match the account you logged in with",
                                extendedMessage: `Username did not match (expected: ${cachedUsername}, got: ${username})`,
                            });
                        }
                        
                        return Result.ok();
                    }
                    
                    // If we don't have a cached username, try to get a token
                    const tokenResult = await this.getToken(oauthData);
                    if (tokenResult.error) {
                        return Result.err({
                            message: 'Failed to validate token',
                            extendedMessage: tokenResult.error?.message || 'Unknown error'
                        });
                    }
                    
                    const tokenResponse = tokenResult.value;
                    const username = claimFields[0].value;
                    
                    if (username !== tokenResponse.username) {
                        return Result.err({
                            message: "The username didn't match the account you logged in with",
                            extendedMessage: `Username did not match (expected: ${tokenResponse.username}, got: ${username})`,
                        });
                    }
                    
                    return Result.ok();
                } else if (oauthData.token) {
                    const username = claimFields[0].value;
                    
                    const client = createCookieEnabledAxios();
                    
                    const response = await client.get('https://discord.com/api/users/@me', {
                        headers: {
                            Authorization: `Bearer ${oauthData.token}`,
                        },
                    });

                    const user = response.data;
                    const hasDiscriminator = user.discriminator !== undefined && user.discriminator !== '0';
                    const expectedUsername = hasDiscriminator ? `${user.username}#${user.discriminator}` : user.username;
                    
                    if (username !== expectedUsername) {
                        return Result.err({
                            message: "The username didn't match the account you logged in with",
                            extendedMessage: `Username did not match (expected: ${expectedUsername}, got: ${username})`,
                        });
                    }

                    return Result.ok();
                } else {
                    return Result.err({
                        message: 'Invalid OAuth data',
                        extendedMessage: 'Missing code or token in OAuth data'
                    });
                }
            } catch (jsonError) {
                // Try to handle it as a raw token
                try {
                    const client = createCookieEnabledAxios();
                    
                    const response = await client.get('https://discord.com/api/users/@me', {
                        headers: {
                            Authorization: `Bearer ${challengeResponse}`,
                        },
                    });
                    
                    const user = response.data;
                    const hasDiscriminator = user.discriminator !== undefined && user.discriminator !== '0';
                    const expectedUsername = hasDiscriminator ? `${user.username}#${user.discriminator}` : user.username;
                    
                    const username = claimFields[0].value;
                    if (username !== expectedUsername) {
                        return Result.err({
                            message: "The username didn't match the account you logged in with",
                            extendedMessage: `Username did not match (expected: ${expectedUsername}, got: ${username})`,
                        });
                    }
                    
                    return Result.ok();
                } catch (apiError) {
                    return Result.err({
                        message: 'Invalid Discord token format',
                        extendedMessage: 'The token could not be used to authenticate with Discord'
                    });
                }
            }
        } catch (err: any) {
            if (err.response) {
                return httpResponseToError(
                    err.response.status, 
                    JSON.stringify(err.response.data), 
                    'Discord API validation'
                );
            }
            
            return Result.err({
                message: 'Discord token validation failed',
                extendedMessage: err.message
            });
        }
    }

    public healthCheck(): Promise<Result<void>> {
        throw new Error('Method not implemented.');
    }

    // Add these properties to the class
    private tokenCache = new Map<string, TokenResponse>();
    private usernameCache = new Map<string, string>();
}

export const Discord: Platform = {
    name: 'Discord',
    verifiers: [new DiscordOAuthVerifier()],
    version: 1,
};
