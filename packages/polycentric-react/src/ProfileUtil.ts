import * as Base64 from '@borderless/base64';

import * as Core from 'polycentric-core';

function profileToLink(profile: Core.Protocol.StorageTypeProfile): string {
    return Base64.encodeUrl(
        Core.Protocol.URLInfo.encode({
            publicKey: profile.publicKey,
            servers: profile.servers,
        }).finish(),
    );
}

export function profileToLinkOnlyKey(publicKey: Uint8Array): string {
    return Base64.encodeUrl(
        Core.Protocol.URLInfo.encode({
            publicKey: publicKey,
            servers: [],
        }).finish(),
    );
}

export type DisplayableProfile = {
    displayName: string;
    identity: string;
    link: string;
    avatar?: string;
    status: string;
    description: string;
    following: boolean;
    allowFollow: boolean;
};

export async function loadProfileOrFallback(
    state: Core.DB.PolycentricState,
    publicKey: Uint8Array,
    needPointersOut: Array<Core.Protocol.Pointer>,
): Promise<DisplayableProfile> {
    let displayable = await loadDisplayableProfile(
        state,
        publicKey,
        needPointersOut,
    );

    if (displayable !== undefined) {
        return displayable;
    } else {
        const fallback = {
            displayName: 'unknown',
            identity: Base64.encodeUrl(publicKey),
            link: profileToLinkOnlyKey(publicKey),
            avatar: undefined,
            status: '',
            description: '',
            following: false,
            allowFollow: false,
        };

        return fallback;
    }
}

async function loadDisplayableProfile(
    state: Core.DB.PolycentricState,
    publicKey: Uint8Array,
    needPointersOut: Array<Core.Protocol.Pointer>,
): Promise<DisplayableProfile | undefined> {
    const potentialProfile = await Core.DB.tryLoadKey(
        state.levelProfiles,
        publicKey,
    );

    if (potentialProfile === undefined) {
        return undefined;
    }

    const profile: Core.Protocol.StorageTypeProfile =
        Core.Protocol.StorageTypeProfile.decode(potentialProfile);

    const decoder = new TextDecoder();

    let result: DisplayableProfile = {
        displayName: decoder.decode(profile.username),
        identity: Base64.encodeUrl(publicKey),
        link: profileToLink(profile),
        avatar: undefined,
        status: await Core.DB.makeSyncStatusString(state, publicKey),
        description: decoder.decode(profile.description),
        following: await Core.DB.levelAmFollowing(state, publicKey),
        allowFollow: true,
    };

    if (profile.imagePointer !== undefined) {
        const loaded = await Core.DB.loadBlob(
            state,
            profile.imagePointer,
            needPointersOut,
        );

        if (loaded !== undefined) {
            result.avatar = Core.Util.blobToURL(loaded.kind, loaded.blob);
        }
    }

    if (
        state.identity !== undefined &&
        Core.Util.blobsEqual(state.identity.publicKey, publicKey)
    ) {
        result.allowFollow = false;
    }

    return result;
}
