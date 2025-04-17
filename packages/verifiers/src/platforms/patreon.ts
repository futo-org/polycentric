import parse from 'node-html-parser';
import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { createCookieEnabledAxios } from '../utility';
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
        const profileUrl = `https://www.patreon.com/${handle}`;

        try {
            console.log(`[Patreon.getText] Attempting to fetch profile: ${profileUrl}`);
            const profileResponse = await client.get(profileUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });

            console.log(`[Patreon.getText] Received status: ${profileResponse.status}`);

            if (profileResponse.status !== 200) {
                console.error(`[Patreon.getText] Failed request details: Status=${profileResponse.status}, StatusText=${profileResponse.statusText}, Data=${profileResponse.data ? profileResponse.data.substring(0, 500) + '...' : 'N/A'}`);
                return Result.err({
                    message: 'Unable to find your account',
                    extendedMessage: `Failed to get Profile page (${profileResponse.status}): '${profileResponse.statusText}'. Patreon might be blocking the request.`,
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
        } catch (error: any) {
            console.error(`[Patreon.getText] Axios error fetching profile ${profileUrl}:`, error.message);
            if (error.response) {
                console.error(`[Patreon.getText] Axios error response: Status=${error.response.status}, Data=${error.response.data ? String(error.response.data).substring(0, 500) + '...' : 'N/A'}`);
                return Result.err({
                    message: 'Failed to connect to Patreon profile',
                    extendedMessage: `Error fetching profile: ${error.response.status} ${error.response.statusText}. Patreon might be blocking the request.`,
                });
            } else if (error.request) {
                console.error(`[Patreon.getText] Axios error: No response received for ${profileUrl}`);
                return Result.err({
                    message: 'No response from Patreon',
                    extendedMessage: 'The request to Patreon timed out or received no response.',
                });
            } else {
                return Result.err({
                    message: 'Error setting up request to Patreon',
                    extendedMessage: error.message,
                });
            }
        }
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
