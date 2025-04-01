import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBlobDisplayURL } from '../../../../hooks/imageHooks';
import { Profile } from '../../../../types/profile';
import { Modal } from '../../../util/modal';
import { ProfileAvatarInput } from '../inputs/ProfileAvatarInput';
import { ProfileBackgroundInput } from '../inputs/ProfileBackgroundInput';
import { ProfileTextArea, ProfileTextInput } from '../inputs/ProfileTextInput';

export interface EditProfileActions {
  changeUsername: (username: string) => Promise<unknown>;
  changeDescription: (description: string) => Promise<unknown>;
  changeAvatar: (blob: Blob) => Promise<unknown>;
  changeBackground: (blob: Blob) => Promise<unknown>;
}

const InnerPureEditProfile = ({
  profile,
  actions,
  setOpen,
  setTitle,
}: {
  profile: Profile;
  actions: EditProfileActions;
  open: boolean;
  setOpen: (b: boolean) => void;
  setTitle: (s: string) => void;
}) => {
  const [username, setUsername] = useState<string | undefined>();
  const [description, setDescription] = useState<string | undefined>();
  const [avatar, setAvatarState] = useState<Blob | undefined>(undefined);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [background, setBackgroundState] = useState<Blob | undefined>(
    undefined,
  );
  const [backgroundChanged, setBackgroundChanged] = useState(false);

  const displayUsername = useMemo(
    () => username ?? profile.name,
    [username, profile.name],
  );
  const displayDescription = useMemo(
    () => description ?? profile.description,
    [description, profile.description],
  );
  const blobUrl = useBlobDisplayURL(avatar);
  const backgroundBlobUrl = useBlobDisplayURL(background);
  const currentAvatarURL = useMemo(
    () => blobUrl ?? profile.avatarURL,
    [blobUrl, profile.avatarURL],
  );
  const currentBackgroundURL = useMemo(
    () => backgroundBlobUrl ?? profile.backgroundURL,
    [backgroundBlobUrl, profile.backgroundURL],
  );

  const {
    avatarValidAndChanged,
    descriptionValidAndChanged,
    usernameValidAndChanged,
    backgroundValidAndChanged,
    validAndChanged,
  } = useMemo(() => {
    // We check to make sure profile.name is defined because it's possible that the profile hasn't loaded yet and that would count as a difference
    const usernameValidAndChanged =
      username !== undefined &&
      username !== profile.name &&
      username.length > 0 &&
      username.length <= 32;
    const descriptionValidAndChanged =
      description !== undefined &&
      (profile.description ?? '') !== description &&
      description.length <= 256 &&
      (description.match(/\n/g)?.length ?? 0) <= 2;
    const avatarValidAndChanged = avatar !== undefined && avatarChanged;
    const backgroundValidAndChanged =
      background !== undefined && backgroundChanged;

    return {
      validAndChanged:
        usernameValidAndChanged ||
        descriptionValidAndChanged ||
        avatarValidAndChanged ||
        backgroundValidAndChanged,
      usernameValidAndChanged,
      descriptionValidAndChanged,
      avatarValidAndChanged,
      backgroundValidAndChanged,
    };
  }, [
    username,
    description,
    avatar,
    background,
    profile,
    avatarChanged,
    backgroundChanged,
  ]);

  const setAvatar = useCallback((blob?: Blob) => {
    setAvatarState(blob);
    setAvatarChanged(true);
  }, []);

  const setBackground = useCallback((blob?: Blob) => {
    setBackgroundState(blob);
    setBackgroundChanged(true);
  }, []);

  const onSave = useCallback(async () => {
    if (!validAndChanged) return;

    // These actions aren't concurrency safe, but we also don't want to block the UI on their completion
    const update = async () => {
      if (usernameValidAndChanged && username) {
        await actions.changeUsername(username);
      }
      if (descriptionValidAndChanged && description !== undefined) {
        await actions.changeDescription(description);
      }
      if (avatarValidAndChanged && avatar) {
        await actions.changeAvatar(avatar);
      }
      if (backgroundValidAndChanged && background) {
        await actions.changeBackground(background);
      }
    };
    update();

    setOpen(false);
  }, [
    validAndChanged,
    usernameValidAndChanged,
    username,
    actions,
    descriptionValidAndChanged,
    description,
    avatarValidAndChanged,
    avatar,
    backgroundValidAndChanged,
    background,
    setOpen,
  ]);

  useEffect(
    () => setTitle(`${displayUsername}'s profile`),
    [displayUsername, setTitle],
  );

  const onDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // if over 3 lines, don't allow more
      if ((e.target.value.match(/\n/g)?.length ?? 0) > 2) return;
      setDescription(e.target.value);
    },
    [setDescription],
  );

  return (
    <div className="w-full md:w-[35rem] space-y-2">
      <ProfileBackgroundInput
        title="Background Image"
        setCroppedImage={setBackground}
        originalImageURL={currentBackgroundURL}
      />
      <ProfileAvatarInput
        title="Avatar"
        setCroppedImage={setAvatar}
        originalImageURL={currentAvatarURL}
      />
      <ProfileTextInput
        title="Name"
        value={displayUsername}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={32}
      />
      <ProfileTextArea
        title="Description"
        value={displayDescription}
        onChange={onDescriptionChange}
        maxLength={256}
      />
      <div className="h-3" />
      <button
        className="disabled:bg-white disabled:text-gray-500 bg-slate-50 border text-black px-4 py-2 rounded-full  h-[3rem] md:self-end"
        disabled={!validAndChanged}
        onClick={onSave}
      >
        Save
      </button>
    </div>
  );
};

export const PureEditProfile = ({
  profile,
  actions,
  open,
  setOpen,
}: {
  profile: Profile;
  actions: EditProfileActions;
  open: boolean;
  setOpen: (b: boolean) => void;
}) => {
  const [title, setTitle] = useState<string | undefined>(() =>
    profile.name ? `${profile.name}'s profile` : 'Profile',
  );

  return (
    // we use an inner component so that we can reset the state when the modal is closed
    <Modal title={title} open={open} setOpen={setOpen}>
      <InnerPureEditProfile
        profile={profile}
        actions={actions}
        open={open}
        setOpen={setOpen}
        setTitle={setTitle}
      />
    </Modal>
  );
};
