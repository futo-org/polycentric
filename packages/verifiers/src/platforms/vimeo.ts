import { ClaimField, Platform } from '../models';
import { createCookieEnabledAxios } from '../utility';
import { Result } from '../result';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

class VimeoTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [
        {
            expectedText: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
            claimFields: <ClaimField[]>[{ key: 0, value: 'osotnoc' }],
        },
    ];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://vimeo.com/futo',
            expectedClaimFields: [{ key: 0, value: 'futo' }],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeVimeo);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        if (claimField.key !== 0) {
            const msg = `Invalid claim field type ${claimField.key}.`;
            return Result.err({ message: msg, extendedMessage: msg });
        }

        const client = createCookieEnabledAxios();
        const nextResponse = await client.get('https://vimeo.com/_next/viewer');
        if (!nextResponse.data || !nextResponse.data.jwt) {
            return Result.err({
                message: 'Unable to retrieve Vimeo JWT for request authorization',
            });
        }

        const userResponse = await client.get(`https://api.vimeo.com/users/${claimField.value}?fields=bio&fetch_user_profile=1`, {
            headers: {
                Authorization: `jwt ${nextResponse.data.jwt}`,
            },
        });

        if (!userResponse.data || !userResponse.data.bio) {
            return Result.err({
                message: 'Unable to retrieve user bio from Vimeo',
            });
        }

        return Result.ok(userResponse.data.bio);
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        const match = /https:\/\/(?:www\.)?vimeo\.com\/([^/]+)\/?/.exec(url);
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

export const Vimeo: Platform = {
    name: 'Vimeo',
    verifiers: [new VimeoTextVerifier()],
    version: 1,
};
