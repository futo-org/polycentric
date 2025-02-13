import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

class YoutubeTextVerifier extends TextVerifier {
    private internalIdRegex = /https:\/\/(?:www\.)?youtube\.com\/channel\/([^/]+)\/?/;
    private handleRegex = /https:\/\/(?:www\.)?youtube\.com\/([^/]+)\/?/;

    protected testDataVerification: TextVerifierVerificationTestData[] = [
        {
            expectedText: `Hv2o+4ruwg9ZL1dKdh/ezp2bPENyVFRccqavfZwCUs0=`,
            claimFields: <ClaimField[]>[
                { key: 0, value: '@koen-futo' },
                { key: 1, value: 'UCR7KMD7jkSefYYWgSwNPEBA' },
            ],
        },
    ];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://www.youtube.com/@koen-futo',
            expectedClaimFields: [
                { key: 0, value: '@koen-futo' },
                { key: 1, value: 'UCR7KMD7jkSefYYWgSwNPEBA' },
            ],
        },
        {
            url: 'https://www.youtube.com/channel/UCR7KMD7jkSefYYWgSwNPEBA',
            expectedClaimFields: [
                { key: 0, value: '@koen-futo' },
                { key: 1, value: 'UCR7KMD7jkSefYYWgSwNPEBA' },
            ],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeYouTube);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        let url: string;
        switch (claimField.key) {
            case 0:
                url = `https://www.youtube.com/${claimField.value}/about`;
                break;
            case 1:
                url = `https://www.youtube.com/channel/${claimField.value}/about`;
                break;
            default: {
                const msg = `Invalid claim field type ${claimField.key}.`;
                return Result.err({ message: msg, extendedMessage: msg });
            }
        }

        const response = await fetch(url);
        const data = await response.text();

        const match = /<meta property="og:description" content="([^"]+)">/.exec(data);
        if (!match) {
            return Result.err({
                message: 'Verifier encountered an error attempting to check your profile description',
                extendedMessage: 'Failed to find description meta tag.',
            });
        }

        return Result.ok(match[1]);
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        const internalIdMatch = this.internalIdRegex.exec(url);
        if (internalIdMatch) {
            const internalId = internalIdMatch[1];
            return this.getClaimFieldsByInternalId(internalId);
        }

        const handleMatch = this.handleRegex.exec(url);
        if (handleMatch) {
            const handle = handleMatch[1];
            if (!handle.startsWith('@')) {
                return Result.err({ message: `Failed to find handle in URL '${url}'.` });
            }

            return this.getClaimFieldsByHandle(handle);
        }

        return Result.err({ message: 'Failed to match channel or user.' });
    }

    private async getClaimFieldsByHandle(handle: string): Promise<Result<ClaimField[]>> {
        const handleClaimField = {
            key: 0,
            value: handle,
        };

        const urlToFetch = `https://www.youtube.com/${handle}`;
        const response = await fetch(urlToFetch);
        if (response.status !== 200) {
            return Result.err({ message: `Failed to get channel page from '${urlToFetch}'.` });
        }

        const profileData = await response.text();
        const ogUrlMatch = /<meta property="og:url" content="([^"]+)">/.exec(profileData);
        if (!ogUrlMatch) {
            return Result.ok([handleClaimField]);
        }

        const ogUrl = ogUrlMatch[1];
        const internalIdMatch = this.internalIdRegex.exec(ogUrl);
        if (!internalIdMatch) {
            return Result.ok([handleClaimField]);
        }

        const internalId = internalIdMatch[1];
        if (!internalId) {
            return Result.ok([handleClaimField]);
        }

        return Result.ok([
            handleClaimField,
            {
                key: 1,
                value: internalId,
            },
        ]);
    }

    private async getClaimFieldsByInternalId(internalId: string): Promise<Result<ClaimField[]>> {
        const internalIdClaimField = {
            key: 1,
            value: internalId,
        };

        const urlToFetch = `https://www.youtube.com/channel/${internalId}`;
        const response = await fetch(urlToFetch);
        if (response.status !== 200) {
            return Result.err({ message: `Failed to get channel page from '${urlToFetch}'.` });
        }

        const profileData = await response.text();
        const originalUrlMatch = /"originalUrl":"([^"]+)"/.exec(profileData);
        if (!originalUrlMatch) {
            return Result.ok([internalIdClaimField]);
        }

        const handleUrl = originalUrlMatch[1];
        const handleMatch = this.handleRegex.exec(handleUrl);
        if (!handleMatch) {
            return Result.ok([internalIdClaimField]);
        }

        const handle = handleMatch[1];
        if (!handle || !handle.startsWith('@')) {
            return Result.ok([internalIdClaimField]);
        }

        return Result.ok([
            {
                key: 0,
                value: handle,
            },
            internalIdClaimField,
        ]);
    }
}

export const Youtube: Platform = {
    name: 'Youtube',
    verifiers: [new YoutubeTextVerifier()],
    version: 1,
};
