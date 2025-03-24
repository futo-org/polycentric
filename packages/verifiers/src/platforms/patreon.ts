import { ClaimField, Platform } from '../models';
import { createCookieEnabledAxios } from '../utility';
import { Result } from '../result';
import parse from 'node-html-parser';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

class PatreonTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [
        {
            expectedText: 'making videos',
            claimFields: <ClaimField[]>[{ key: 0, value: 'thekinocorner' }],
        },
    ];

    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://www.patreon.com/futo',
            expectedClaimFields: [{ key: 0, value: 'futo' }],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypePatreon);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        if (claimField.key !== 0) {
            const msg = `Invalid claim field type ${claimField.key}.`;
            return Result.err({ message: msg, extendedMessage: msg });
        }

        const client = createCookieEnabledAxios();
        const handle = claimField.value;

        const profileResponse = await client.get(`https://www.patreon.com/${handle}`);

        if (profileResponse.status !== 200) {
            return Result.err({
                message: 'Unable to find your account',
                extendedMessage: `Failed to get Profile page (${profileResponse.status}): '${
                    profileResponse.statusText
                } (${profileResponse.toString()})'.`,
            });
        }

        const root = parse(profileResponse.data);

        const descriptionNode = root.querySelector("html head meta[name='description']");

        if (!descriptionNode) {
            return Result.err({
                message: 'Verifier was unable to get a profile description',
                extendedMessage: `Failed to get Profile page (data: ${profileResponse.data.toString()})'.`,
            });
        }

        return Result.ok(descriptionNode.getAttribute('content'));
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        const match = /https:\/\/(?:www\.)?patreon\.com\/([^/]+)\/?/.exec(url);
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

export const Patreon: Platform = {
    name: 'Patreon',
    verifiers: [new PatreonTextVerifier()],
    version: 1,
};
