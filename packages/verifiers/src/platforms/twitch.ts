import { ClaimField, Platform } from '../models';
import { createCookieEnabledAxios } from '../utility';
import { Result } from '../result';
import { TextVerifier, TextVerifierGetClaimFieldsTestData, TextVerifierVerificationTestData } from '../verifier';

import * as Core from '@polycentric/polycentric-core';

class TwitchTextVerifier extends TextVerifier {
    protected testDataVerification: TextVerifierVerificationTestData[] = [
        {
            expectedText: `The Osotnoc Corporation is a multinational business with its headquarters in Waitangi. The company is a manufacturing, sales, and support organization`,
            claimFields: <ClaimField[]>[{ key: 0, value: 'osotnoc' }],
        },
    ];
    protected testDataGetClaimFields: TextVerifierGetClaimFieldsTestData[] = [
        {
            url: 'https://www.twitch.tv/futo/',
            expectedClaimFields: [{ key: 0, value: 'futo' }],
        },
    ];

    constructor() {
        super(Core.Models.ClaimType.ClaimTypeTwitch);
    }

    protected async getText(claimField: ClaimField): Promise<Result<string>> {
        if (claimField.key !== 0) {
            const msg = `Invalid claim field type ${claimField.key}.`;
            return Result.err({ message: msg, extendedMessage: msg });
        }

        const client = createCookieEnabledAxios();
        const homeResponse = await client.get('https://www.twitch.tv/');
        if (homeResponse.status !== 200) {
            return Result.err({ message: 'Failed to get home page.' });
        }

        const clientIdMatch = /clientId\s*=\s*"(\w+)"/.exec(homeResponse.data);
        if (!clientIdMatch) {
            return Result.err({ message: 'Failed to get client id.' });
        }

        const postData = {
            query: 'query ChannelRoot_AboutPanel($channelLogin: String! $skipSchedule: Boolean!) { currentUser { id login } user(login: $channelLogin) { id description displayName isPartner primaryColorHex profileImageURL(width: 300) followers { totalCount } channel { id socialMedias { ...SocialMedia } schedule @skip(if: $skipSchedule) { id nextSegment { id startAt hasReminder } } } lastBroadcast { id game { id displayName } } primaryTeam { id name displayName } videos(first: 30 sort: TIME type: ARCHIVE) { edges { ...userBioVideo } } } } fragment userBioVideo on VideoEdge { node { id game { id displayName } status } } fragment SocialMedia on SocialMedia { id name title url }',
            operationName: 'ChannelRoot_AboutPanel',
            variables: {
                channelLogin: claimField.value,
                skipSchedule: true,
            },
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: '6089531acef6c09ece01b440c41978f4c8dc60cb4fa0124c9a9d3f896709b6c6',
                },
            },
        };

        const clientId = clientIdMatch[1];
        const response = await client.post('https://gql.twitch.tv/gql', postData, {
            headers: {
                'Content-Type': 'application/json',
                Host: 'gql.twitch.tv',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Client-Id': clientId,
            },
        });

        if (response.status !== 200) {
            return Result.err({
                message: `Get about pannel request returned (status = ${response.status}, status_text = ${response.statusText}, response = ${response}).`,
            });
        }

        if (!response.data || !response.data.data || !response.data.data.user) {
            return Result.err({
                message: 'Unable to retrieve user data from Twitch',
            });
        }

        return Result.ok(response.data.data.user.description);
    }

    public async getClaimFieldsByUrl(url: string): Promise<Result<ClaimField[]>> {
        const match = /https:\/\/(?:www\.)?twitch\.tv\/([^/]+)\/?/.exec(url);
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

export const Twitch: Platform = {
    name: 'Twitch',
    verifiers: [new TwitchTextVerifier()],
    version: 1,
};
