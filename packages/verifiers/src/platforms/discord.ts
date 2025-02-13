import { createCookieEnabledAxios, getCallbackForPlatform, httpResponseToError } from '../utility';
import { Result } from '../result';
import { ClaimField, Platform, TokenResponse } from '../models';
import { StatusCodes } from 'http-status-codes';
import { OAuthVerifier } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

type DiscordTokenRequest = {
    code: string;
};

class DiscordOAuthVerifier extends OAuthVerifier<DiscordTokenRequest> {
    constructor() {
        super(Core.Models.ClaimType.ClaimTypeDiscord);
    }

    public async getOAuthURL(): Promise<Result<string>> {
        if (process.env.DISCORD_CLIENT_ID === undefined || process.env.OAUTH_CALLBACK_DOMAIN === undefined) {
            return Result.errMsg('Verifier not configured');
        } else {
            const redirectUri = getCallbackForPlatform(this.claimType, true);
            return Result.ok(
                `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify`
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

        const redirectUri = getCallbackForPlatform(this.claimType);
        const client = createCookieEnabledAxios();
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

        const token = resp.data.access_token;
        const discordResponse = await client.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: 'Bearer ' + token,
            },
        });

        if (discordResponse.status === StatusCodes.OK) {
            const user = discordResponse.data;
            const hasDiscriminator = user.discriminator !== undefined && user.discriminator.length == 4;
            const expectedUsername = hasDiscriminator ? `${user.username}#${user.discriminator}` : user.username;
            return Result.ok({ username: expectedUsername, token: token });
        }

        return httpResponseToError(discordResponse.status, discordResponse.data, 'Discord API /users/@me');
    }

    public async isTokenValid(challengeResponse: string, claimFields: ClaimField[]): Promise<Result<void>> {
        const usernameField = claimFields.find((v) => v.key === 0);

        if (usernameField === undefined) {
            return Result.errMsg('The username field was not found in the claim data');
        }

        const username = usernameField.value;
        const client = createCookieEnabledAxios();
        const response = await client.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${challengeResponse}`,
            },
        });

        const user = response.data;
        const hasDiscriminator = user.discriminator !== undefined && user.discriminator.length == 4;
        const expectedUsername = hasDiscriminator ? `${user.username}#${user.discriminator}` : user.username;

        if (username !== expectedUsername) {
            return Result.err({
                message: "The username didn't match the account you logged in with",
                extendedMessage: `Username did not match (expected: ${expectedUsername}, got: ${username})`,
            });
        }

        return Result.ok();
    }

    public healthCheck(): Promise<Result<void>> {
        throw new Error('Method not implemented.');
    }
}

export const Discord: Platform = {
    name: 'Discord',
    verifiers: [new DiscordOAuthVerifier()],
    version: 1,
};
