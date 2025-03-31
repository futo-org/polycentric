import { Models, Protocol } from '@polycentric/polycentric-core';
import { useCallback, useMemo, useState } from 'react';
import { useAvatar, useBackground } from '../../../../hooks/imageHooks';
import { useProcessHandleManager } from '../../../../hooks/processHandleManagerHooks';
import {
  useClaims,
  useDescriptionCRDTQuery,
  useQueryIfAdded,
  useSystemLink,
  useUsernameCRDTQuery,
} from '../../../../hooks/queryHooks';
import {
  publishBlobToAvatar,
  publishBlobToBackground,
} from '../../../../util/imageProcessing';
import { PureMobileFeedProfile } from '../PureMobileFeedProfile';

export const MobileProfileFeed = ({
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

  const [forceRefreshCounter, setForceRefreshCounter] = useState(0);
  const refreshQueries = useCallback(() => {
    setForceRefreshCounter((count) => count + 1);
  }, []);

  const encodedSystem = useMemo(
    () => Protocol.PublicKey.encode(system).finish(),
    [system],
  );

  const iAmFollowing = useQueryIfAdded(
    Models.ContentType.ContentTypeFollow,
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

  const isMyProfile = Models.PublicKey.equal(system, processHandle.system());

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

  const profile = useMemo(
    () => ({
      name,
      description,
      avatarURL,
      backgroundURL,
      isMyProfile,
      iAmFollowing: iAmFollowing ?? false,
      followerCount: followers,
      followingCount: following,
      system,
    }),
    [
      name,
      description,
      avatarURL,
      backgroundURL,
      isMyProfile,
      iAmFollowing,
      followers,
      following,
      system,
    ],
  );

  const profileURL = useSystemLink(system);

  const share = useCallback(() => {
    profileURL &&
      navigator.share({
        title: `${name} on Polycentric`,
        text: 'Check out this profile on Polycentric',
        url: profileURL,
      });
  }, [profileURL, name]);

  return (
    <PureMobileFeedProfile
      profile={profile}
      editProfileActions={editProfileActions}
      follow={follow}
      unfollow={unfollow}
      share={share}
      claims={claims}
    />
  );
};
