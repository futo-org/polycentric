import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';
import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { createCookieEnabledAxios, httpResponseToError } from '../utility';

import * as Core from '@polycentric/polycentric-core';
import { StatusCodes } from 'http-status-codes';

const BASE_URL_API = 'https://graphql.api.dailymotion.com';
const BASE_URL_API_AUTH = `${BASE_URL_API}/oauth/token`;
const BASE_URL = 'https://www.dailymotion.com';

class DailymotionTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [
        {
            expectedText: 'PUwC97lRE/8yySMaVI5vylfpg91SjdEHKdiFoYI9tR4=',
            claimFields: <ClaimField[]>[{ key: 0, value: 'evaluation-user' }],
        },
    ];

    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://www.dailymotion.com/evaluation-user',
            expectedClaimFields: [{ key: 0, value: 'evaluation-user' }],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeDailymotion);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        if (process.env.DAILYMOTION_CLIENT_ID === undefined || process.env.DAILYMOTION_CLIENT_SECRET === undefined) {
            return Result.errMsg('Verifier not configured');
        }

        if (claimField.key !== 0) {
            const msg = `Invalid claim field type ${claimField.key}.`;
            return Result.err({ message: msg, extendedMessage: msg });
        }

        const client = createCookieEnabledAxios();

        const anonymousTokenResult = await client({
            url: BASE_URL_API_AUTH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: '*/*',
                'Accept-Language': 'en-GB,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                Origin: BASE_URL,
                DNT: '1',
                'Sec-GPC': '1',
                Connection: 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-site',
                Priority: 'u=4',
                Pragma: 'no-cache',
                'Cache-Control': 'no-cache',
            },
            data: {
                grant_type: 'client_credentials',
                client_id: process.env.DAILYMOTION_CLIENT_ID,
                client_secret: process.env.DAILYMOTION_CLIENT_SECRET,
            },
        });

        if (anonymousTokenResult.status !== StatusCodes.OK) {
            return httpResponseToError(anonymousTokenResult.status, anonymousTokenResult.data, 'Dailymotion API /oauth/access_token');
        }

        const profileResult = await client({
            url: BASE_URL_API,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${anonymousTokenResult.data.access_token}`,
                Accept: '*/*',
                Referer: BASE_URL,
                Origin: BASE_URL,
                DNT: '1',
                Connection: 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-site',
                Pragma: 'no-cache',
                'Cache-Control': 'no-cache',
            },
            data: {
                query: `query CHANNEL_QUERY_DESKTOP($channel_name: String!) {
                channel(name: $channel_name) {
                  description
                }
              }`,
                variables: { channel_name: claimField.value },
            },
        });

        if (profileResult.status !== StatusCodes.OK) {
            return httpResponseToError(profileResult.status, profileResult.data, 'Dailymotion API channel');
        }

        return Result.ok(profileResult.data.data.channel.description.trim());
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        const match = /https:\/\/(?:www\.)?dailymotion\.com\/([^/]+)\/?/.exec(url);
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

export const Dailymotion: Platform = {
    name: 'Dailymotion',
    verifiers: [new DailymotionTextVerifier()],
    version: 1,
};
