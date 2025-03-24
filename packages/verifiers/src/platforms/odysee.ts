import { createCookieEnabledAxios } from '../utility';
import { Result } from '../result';
import { ClaimField, Platform } from '../models';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

class OdyseeTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://odysee.com/@TheKinoCorner:2',
            expectedClaimFields: [
                { key: 0, value: '@TheKinoCorner' },
                { key: 1, value: '273163260bceb95fa98d97d33d377c55395e329a' },
            ],
        },
        {
            url: 'lbry://@TheKinoCorner:2',
            expectedClaimFields: [
                { key: 0, value: '@TheKinoCorner' },
                { key: 1, value: '273163260bceb95fa98d97d33d377c55395e329a' },
            ],
        },
        {
            url: 'https://odysee.com/@TheKinoCorner',
            expectedClaimFields: [
                { key: 0, value: '@TheKinoCorner' },
                { key: 1, value: '273163260bceb95fa98d97d33d377c55395e329a' },
            ],
        },
        {
            url: 'lbry://@TheKinoCorner',
            expectedClaimFields: [
                { key: 0, value: '@TheKinoCorner' },
                { key: 1, value: '273163260bceb95fa98d97d33d377c55395e329a' },
            ],
        },
        {
            url: 'lbry://@TheKinoCorner#273163260bceb95fa98d97d33d377c55395e329a',
            expectedClaimFields: [
                { key: 0, value: '@TheKinoCorner' },
                { key: 1, value: '273163260bceb95fa98d97d33d377c55395e329a' },
            ],
        },
        {
            url: 'lbry://@TheKinoCorner:2#273163260bceb95fa98d97d33d377c55395e329a',
            expectedClaimFields: [
                { key: 0, value: '@TheKinoCorner' },
                { key: 1, value: '273163260bceb95fa98d97d33d377c55395e329a' },
            ],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeOdysee);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        switch (claimField.key) {
            case 0:
                return await this.getTextFromLbryId(claimField.value);
            case 1:
                return await this.getTextFromClaimId(claimField.value);
            default: {
                const msg = `Invalid claim field type ${claimField.key}.`;
                return Result.err({ message: msg, extendedMessage: msg });
            }
        }
    }

    private async getTextFromLbryId(id: string): Promise<Result<string>> {
        const client = createCookieEnabledAxios();
        const lbryId = `lbry://${id}`;
        const postData = {
            jsonrpc: '2.0',
            method: 'resolve',
            params: {
                urls: [lbryId],
            },
        };

        const profileResult = await client.post('https://api.na-backend.odysee.com/api/v1/proxy?m=resolve', postData);
        if (profileResult.status !== 200) {
            return Result.err({
                message: 'Unable to find your account',
                extendedMessage: `Failed to get Profile page (${profileResult.status}): '${profileResult.statusText}'.`,
            });
        }

        const description: string = profileResult.data?.result?.[lbryId]?.value?.description;
        return Result.ok(description);
    }

    private async getTextFromClaimId(id: string): Promise<Result<string>> {
        const client = createCookieEnabledAxios();
        const postData = {
            jsonrpc: '2.0',
            method: 'claim_search',
            params: {
                claim_ids: [id],
            },
        };

        const profileResult = await client.post('https://api.na-backend.odysee.com/api/v1/proxy?m=claim_search', postData);
        if (profileResult.status !== 200) {
            return Result.err({
                message: 'Unable to find your account',
                extendedMessage: `Failed to get Profile page (${profileResult.status}): '${profileResult.statusText}'.`,
            });
        }

        const description: string = profileResult.data?.result?.items?.[0]?.value?.description;
        return Result.ok(description.trim());
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        let id: string;
        if (url.startsWith('lbry://')) {
            const match = /lbry:\/\/([^/\n\r:#]+)/.exec(url);
            if (!match) {
                return Result.err({ message: 'Failed to match regex' });
            }

            id = match[1];
        } else {
            const match = /https:\/\/(?:www\.)?odysee\.com\/([^/\n\r:#]+)/.exec(url);
            if (!match) {
                return Result.err({ message: 'Failed to match regex' });
            }

            id = match[1];
        }

        const lbryId = `lbry://${id}`;
        const postData = {
            jsonrpc: '2.0',
            method: 'resolve',
            params: {
                urls: [lbryId],
            },
        };

        const client = createCookieEnabledAxios();
        const profileResult = await client.post('https://api.na-backend.odysee.com/api/v1/proxy?m=resolve', postData);
        if (profileResult.status !== 200) {
            return Result.err({
                message: 'Unable to find your account',
                extendedMessage: `Failed to get Profile page (${profileResult.status}): '${profileResult.statusText}'.`,
            });
        }

        const claimId: string = profileResult.data?.result?.[lbryId]?.['claim_id'];
        if (!claimId) {
            return Result.err({ message: 'Failed to get claim_id.', extendedMessage: JSON.stringify(profileResult.data) });
        }

        return Result.ok([
            {
                key: 0,
                value: id,
            },
            {
                key: 1,
                value: claimId,
            },
        ]);
    }
}

export const Odysee: Platform = {
    name: 'Odysee',
    verifiers: [new OdyseeTextVerifier()],
    version: 1,
};
