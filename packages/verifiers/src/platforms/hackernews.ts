import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';
import { createCookieEnabledAxios } from '../utility';

import * as Core from '@polycentric/polycentric-core';

class HackerNewsTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [
        {
            expectedText: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
            claimFields: <ClaimField[]>[{ key: 0, value: 'osotnoc' }],
        },
    ];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://news.ycombinator.com/user?id=futo',
            expectedClaimFields: [{ key: 0, value: 'futo' }],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeHackerNews);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        if (claimField.key !== 0) {
            const msg = `Invalid claim field type ${claimField.key}.`;
            return Result.err({ message: msg, extendedMessage: msg });
        }

        const client = createCookieEnabledAxios();
        const profileResult = await client({ url: `https://hacker-news.firebaseio.com/v0/user/${claimField.value}.json` });
        if (profileResult.status !== 200) {
            return Result.err({
                message: 'Unable to find your account',
                extendedMessage: `Failed to get Profile page (${profileResult.status}): '${
                    profileResult.statusText
                } (${profileResult.toString()})'.`,
            });
        }

        return Result.ok(profileResult.data.about.trim());
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        const match = /https:\/\/news\.ycombinator\.com\/user?.+id=(.+)/.exec(url);
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

export const HackerNews: Platform = {
    name: 'hackernews',
    verifiers: [new HackerNewsTextVerifier()],
    version: 1,
};
