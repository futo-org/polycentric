import { ClaimField, Platform } from '../models';
import { createCookieEnabledAxios } from '../utility';
import { Result } from '../result';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';
import { StatusCodes } from 'http-status-codes';
import parse from 'node-html-parser';

import * as Core from '@polycentric/polycentric-core';

class SubstackTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [
        {
            expectedText: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
            claimFields: <ClaimField[]>[{ key: 0, value: 'osotnoc' }],
        },
    ];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://futo.substack.com/',
            expectedClaimFields: [{ key: 0, value: 'futo' }],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeSubstack);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        if (claimField.key !== 0) {
            const msg = `Invalid claim field type ${claimField.key}.`;
            return Result.err({ message: msg, extendedMessage: msg });
        }

        const client = createCookieEnabledAxios();
        const profileResponse = await client.get(`https://${claimField.value}.substack.com`);

        if (profileResponse.status !== 200) {
            return Result.err({
                message: 'Unable to find your Substack account',
                extendedMessage: `Failed to get Profile page (${profileResponse.status}): '${
                    profileResponse.statusText
                } (${profileResponse.toString()})'.`,
                statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
            });
        }

        const root = parse(profileResponse.data.toString());
        const node = root.querySelector('.publication-tagline');

        if (!node) {
            return Result.err({
                message: 'Verifier encountered an error attempting to check your profile description',
                extendedMessage: "Failed to find node '.publication-tagline'.",
                statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
            });
        }

        return Result.ok(node.textContent.trim());
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        const match = /https:\/\/(?:www\.)?(.+)\.substack\.com\/?/.exec(url);
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

export const Substack: Platform = {
    name: 'Substack',
    verifiers: [new SubstackTextVerifier()],
    version: 1,
};
