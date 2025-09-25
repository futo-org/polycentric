/**
 * @fileoverview User column with data fetching and state management.
 */

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

// User column with follow/block actions and edit capabilities
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

  // Add useState at the top level instead of inside useMemo
  const [forceRefreshCounter, setForceRefreshCounter] = useState(0);
  const refreshQueries = useCallback(() => {
    setForceRefreshCounter((count) => count + 1);
  }, []);

  const encodedSystem = useMemo(
    () => Protocol.PublicKey.encode(system).finish(),
    [system],
  );

  // Add the refreshCounter to the dependency array to force re-fetch
  const iAmFollowing = useQueryIfAdded(
    Models.ContentType.ContentTypeFollow,
    processHandle.system(),
    encodedSystem,
    forceRefreshCounter,
  );

  const iBlocked = useQueryIfAdded(
    Models.ContentType.ContentTypeBlock,
    processHandle.system(),
    encodedSystem,
    forceRefreshCounter,
  );

  const follow = useCallback(() => {
    processHandle.follow(system).then(() => refreshQueries());
  }, [processHandle, system, refreshQueries]);

  const unfollow = useCallback(() => {
    processHandle.unfollow(system).then(() => refreshQueries());
  }, [processHandle, system, refreshQueries]);

  const block = useCallback(() => {
    processHandle.block(system).then(() => refreshQueries());
  }, [processHandle, system, refreshQueries]);

  const unblock = useCallback(() => {
    processHandle.unblock(system).then(() => refreshQueries());
  }, [processHandle, system, refreshQueries]);

  const isMyProfile = useMemo(
    () => Models.PublicKey.equal(system, processHandle.system()),
    [system, processHandle],
  );

  const followers = 0;
  const following = 0;

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
      iAmFollowing,
      iBlocked,
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
