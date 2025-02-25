import { Models, Protocol } from '@polycentric/polycentric-core';
import { useCallback, useMemo, useState } from 'react';
import { useAvatar, useBackground } from '../../../../hooks/imageHooks';
import { useProcessHandleManager } from '../../../../hooks/processHandleManagerHooks';
import {
    useClaims,
    useDescriptionCRDTQuery,
    useQueryIfAdded,
    useUsernameCRDTQuery,
} from '../../../../hooks/queryHooks';
import {
    publishBlobToAvatar,
    publishBlobToBackground,
} from '../../../../util/imageProcessing';
import { PureSidebarProfile } from '../PureSidebarProfile';

export const UserColumn = ({
    system,
}: {
    system: Models.PublicKey.PublicKey;
}) => {
    const name = useUsernameCRDTQuery(system);
    const description = useDescriptionCRDTQuery(system);
    const avatarURL = useAvatar(system);
    const backgroundURL = useBackground(system);

    const claims = useClaims(system);

    const { processHandle } = useProcessHandleManager();

    const [localFollowing, setLocalFollowing] = useState<boolean | undefined>();
    const [localBlocked, setLocalBlocked] = useState<boolean | undefined>();

    const encodedSystem = useMemo(
        () => Protocol.PublicKey.encode(system).finish(),
        [system],
    );

    const remotelyFollowing = useQueryIfAdded(
        Models.ContentType.ContentTypeFollow,
        processHandle.system(),
        encodedSystem,
    );

    const remotelyBlocked = useQueryIfAdded(
        Models.ContentType.ContentTypeBlock,
        processHandle.system(),
        encodedSystem,
    );

    const follow = useCallback(() => {
        processHandle.follow(system).then(() => setLocalFollowing(true));
    }, [processHandle, system]);

    const unfollow = useCallback(() => {
        processHandle.unfollow(system).then(() => setLocalFollowing(false));
    }, [processHandle, system]);

    const block = useCallback(() => {
        processHandle.block(system).then(() => setLocalBlocked(true));
    }, [processHandle, system]);

    const unblock = useCallback(() => {
        processHandle.unblock(system).then(() => setLocalBlocked(false));
    }, [processHandle, system]);

    const isMyProfile = useMemo(
        () => Models.PublicKey.equal(system, processHandle.system()),
        [system, processHandle],
    );

    const followers = 0;
    const following = 0;

    const iAmFollowing = useMemo(
        () => (localFollowing ? localFollowing : remotelyFollowing),
        [localFollowing, remotelyFollowing],
    );

    const iBlocked = useMemo(
        () => (localBlocked ? localBlocked : remotelyBlocked),
        [localBlocked, remotelyBlocked],
    );

    const editProfileActions = useMemo(() => {
        return {
            changeUsername: (name: string) => processHandle.setUsername(name),
            changeDescription: (description: string) =>
                processHandle.setDescription(description),
            changeAvatar: async (blob: Blob) =>
                publishBlobToAvatar(blob, processHandle),
            changeBackground: async (blob: Blob) =>
                publishBlobToBackground(blob, processHandle),
        };
    }, [processHandle]);

    const profile = useMemo(() => {
        return {
            name,
            description,
            avatarURL,
            backgroundURL,
            isMyProfile,
            iAmFollowing: iAmFollowing,
            iBlocked: iBlocked,
            followerCount: followers,
            followingCount: following,
            system,
        };
    }, [
        name,
        description,
        avatarURL,
        backgroundURL,
        isMyProfile,
        iAmFollowing,
        iBlocked,
        followers,
        following,
        system,
    ]);

    return (
        <PureSidebarProfile
            profile={profile}
            editProfileActions={editProfileActions}
            follow={follow}
            unfollow={unfollow}
            block={block}
            unblock={unblock}
            claims={claims}
        />
    );
};
