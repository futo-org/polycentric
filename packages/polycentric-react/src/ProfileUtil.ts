import * as Base64 from '@borderless/base64';

import * as Core from 'polycentric-core';

function profileToLink(profile: Core.Protocol.StorageTypeProfile): string {
    const username = encodeURIComponent(
        new TextDecoder().decode(profile.username)
    );

    return "feed/" + username + '/' + Base64.encodeUrl(
        Core.Protocol.URLInfo.encode({
            publicKey: profile.publicKey,
            servers: profile.servers,
        }).finish(),
    );
}

export function profileToLinkOnlyKey(publicKey: Uint8Array): string {
    return "feed/unknown/" + Base64.encodeUrl(
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
    servers: Array<Uint8Array>;
};

export async function loadProfileOrFallback(
    state: Core.DB.PolycentricState,
    publicKey: Uint8Array,
    dependencyContext: Core.DB.DependencyContext,
): Promise<DisplayableProfile> {
    let displayable = await loadDisplayableProfile(
        state,
        publicKey,
        dependencyContext,
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
            servers: [],
        };

        return fallback;
    }
}

async function loadDisplayableProfile(
    state: Core.DB.PolycentricState,
    publicKey: Uint8Array,
    dependencyContext: Core.DB.DependencyContext,
): Promise<DisplayableProfile | undefined> {
    const fullKey = new Uint8Array([
        ...new TextEncoder().encode('!profiles!'),
        ...publicKey,
    ]);

    dependencyContext.addDependencyByKey(fullKey);

    const potentialProfile = await Core.DB.tryLoadKey(state.level, fullKey);

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
        servers: profile.servers,
    };

    if (profile.imagePointer !== undefined) {
        const loaded = await Core.DB.loadBlob(
            state,
            profile.imagePointer,
            dependencyContext,
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
