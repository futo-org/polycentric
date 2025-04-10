import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { createCookieEnabledAxios } from '../utility';
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
        try {
            const client = createCookieEnabledAxios();
            const lbryId = id.startsWith('@') ? `lbry://${id}` : `lbry://@${id}`;
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

            const responseData = profileResult.data?.result?.[lbryId];
            if (!responseData) {
                return Result.err({
                    message: 'Invalid response data',
                    extendedMessage: `No data returned for ${lbryId}`,
                });
            }

            const description = responseData.value?.description;
            if (description === undefined || description === null) {
                return Result.err({
                    message: 'No description found',
                    extendedMessage: `Channel ${id} does not have a description`,
                });
            }
            
            return Result.ok(description);
        } catch (error) {
            return Result.err({
                message: 'Error connecting to Odysee',
                extendedMessage: `Error during API call: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
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

    protected async verify(pointer: Core.Models.Pointer.Pointer, claimFields: ClaimField[]): Promise<Result<void>> {
        try {
            const expectedPublicKey = Buffer.from(pointer.system.key).toString('base64');

            let isVerified = false;
            for (const claimField of claimFields) {
                const textResult = await this.getText(claimField);
                
                if (!textResult.success) {
                    console.log(`Failed to get text for claim field: ${claimField.key}, ${claimField.value}`);
                    continue;
                }
                
                const text = textResult.value;
                if (!text) {
                    console.log(`Text is empty or undefined for claim field: ${claimField.key}, ${claimField.value}`);
                    continue;
                }
                
                if (text.includes(expectedPublicKey)) {
                    isVerified = true;
                    break;
                }
            }
            
            if (isVerified) {
                return Result.ok(undefined);
            } else {
                return Result.err({
                    message: 'Token not found',
                    extendedMessage: 'The verification token was not found in your Odysee description.',
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Odysee verification error: ${errorMessage}`);
            return Result.err({
                message: 'Verification failed',
                extendedMessage: `An error occurred during verification: ${errorMessage}`,
            });
        }
    }
}

export const Odysee: Platform = {
    name: 'Odysee',
    verifiers: [new OdyseeTextVerifier()],
    version: 1,
};
