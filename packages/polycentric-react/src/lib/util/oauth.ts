import * as Core from '@polycentric/polycentric-core';

const AUTHORITY_SERVER = 'https://verifiers.polycentric.io';

export class AuthorityException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthorityException';
    }
}

export const getOAuthURL = async (
    claimType: Core.Models.ClaimType.ClaimType,
): Promise<string> => {
    const url = `${AUTHORITY_SERVER}/platforms/${claimType}/oauth/url`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new AuthorityException('Failed to get OAuth URL');
    }

    const data = await response.json();
    return data.url;
};

interface OAuthUsernameResponse {
    username: string;
    token: string;
}

export const getOAuthUsername = async (
    token: string,
    claimType: Core.Models.ClaimType.ClaimType,
): Promise<OAuthUsernameResponse> => {
    const url = `${AUTHORITY_SERVER}/platforms/${claimType}/oauth/token/${token}`;

    const response = await fetch(url, {
        headers: {
            'x-polycentric-user-agent': 'polycentric-web',
        },
    });

    if (!response.ok) {
        throw new AuthorityException('Failed to get OAuth username');
    }

    return await response.json();
};

export const requestVerification = async (
    pointer: Core.Protocol.Pointer,
    claimType: Core.Models.ClaimType.ClaimType,
    challengeResponse?: string,
) => {
    try {
        const verifierType = challengeResponse ? 'oauth' : 'text';
        let url = `${AUTHORITY_SERVER}/platforms/${claimType}/${verifierType}/vouch`;

        if (challengeResponse) {
            url += `?challengeResponse=${challengeResponse}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'x-polycentric-user-agent': 'polycentric-web',
            },
            body: Core.Protocol.Pointer.encode(pointer).finish(),
        });

        if (!response.ok) {
            throw new AuthorityException('Verification request failed');
        }
    } catch (err) {
        if (err instanceof TypeError) {
            throw new AuthorityException('Failed to connect to authority');
        }
        throw err;
    }
};
