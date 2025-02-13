import { ClaimField, Platform } from '../models';
import { Result } from '../result';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

class YoutubeTextVerifier extends TextVerifier {
    private internalIdRegex = /https:\/\/(?:www\.)?youtube\.com\/channel\/([^/]+)\/?/;
    private handleRegex = /https:\/\/(?:www\.)?youtube\.com\/@([^/]+)\/?/;

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
            case 0: {
                // Extract handle from URL if it's a full URL
                const handleMatch = this.handleRegex.exec(claimField.value);
                const handle = handleMatch ? handleMatch[1] : claimField.value;
                // Remove any @ prefix if present
                const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
                url = `https://www.youtube.com/${cleanHandle}/about`;
                break;
            }
            case 1:
                // Extract channel ID from URL if it's a full URL
                const channelMatch = this.internalIdRegex.exec(claimField.value);
                const channelId = channelMatch ? channelMatch[1] : claimField.value;
                url = `https://www.youtube.com/channel/${channelId}/about`;
                break;
            default: {
                const msg = `Invalid claim field type ${claimField.key}.`;
                return Result.err({ message: msg, extendedMessage: msg });
            }
        }

        console.log('YouTube verifier attempting to fetch:', {
            claimField,
            url,
            key: claimField.key
        });

        const response = await fetch(url);
        console.log('YouTube response:', {
            status: response.status,
            url: response.url
        });

        if (!response.ok) {
            return Result.err({
                message: `Failed to fetch YouTube profile (${response.status})`,
                extendedMessage: `Failed to fetch ${url} - Status: ${response.status}`
            });
        }

        const data = await response.text();
        console.log('YouTube page content length:', data.length);
        
        const match = /<meta property="og:description" content="([^"]+)">/.exec(data);
        if (!match) {
            // Log the first 500 characters of the response to debug
            console.log('YouTube page content preview:', data.substring(0, 500));
            return Result.err({
                message: 'Could not find YouTube channel description',
                extendedMessage: 'Failed to find description meta tag in YouTube page.'
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
