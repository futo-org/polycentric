/**
 * @fileoverview Pure sidebar profile display component.
 */

import { Models, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { BlockedList } from '../../BlockedList';
import { ClaimGrid } from '../../ClaimGrid';
import { FollowingList } from '../../FollowingList';
import { ProfilePicture } from '../../ProfilePicture';
import {
  EditProfileActions,
  PureEditProfile,
} from '../../edit/PureEditProfile';

export interface PureSidebarProfileData {
  name?: string;
  avatarURL?: string;
  backgroundURL?: string;
  description?: string;
  followerCount?: number;
  followingCount?: number;
  isMyProfile: boolean;
  iAmFollowing?: boolean;
  iBlocked?: boolean;
  system: Models.PublicKey.PublicKey;
}

// Sidebar profile display with centered layout and action buttons
export const PureSidebarProfile = ({
  profile,
  follow,
  unfollow,
  block,
  unblock,
  editProfileActions,
  claims,
}: {
  profile: PureSidebarProfileData;
  follow: () => void;
  unfollow: () => void;
  block: () => void;
  unblock: () => void;
  editProfileActions: EditProfileActions;
  claims: {
    value: Protocol.Claim;
    pointer: Protocol.Reference;
    process: Models.Process.Process;
    logicalClock: Long;
  }[];
}) => {
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [followingPanelOpen, setFollowingPanelOpen] = useState(false);
  const [blockedPanelOpen, setBlockedPanelOpen] = useState(false);

  // Truncate description to 256 characters to match the edit form limit
  const truncatedDescription = useMemo(() => {
    if (!profile.description) return '';
    return profile.description.length > 256
      ? profile.description.slice(0, 256) + '...'
      : profile.description;
  }, [profile.description]);

  return (
    <div className="w-full h-full overflow-y-auto">
      <PureEditProfile
        open={editProfileOpen}
        setOpen={setEditProfileOpen}
        profile={profile}
        actions={editProfileActions}
      />
      <FollowingList
        system={profile.system}
        open={followingPanelOpen}
        setOpen={setFollowingPanelOpen}
      />
      <BlockedList
        system={profile.system}
        open={blockedPanelOpen}
        setOpen={setBlockedPanelOpen}
      />

      {/* Background Image Section */}
      <div className="relative">
        <div
          className="w-full h-48"
          style={{
            backgroundImage: profile.backgroundURL
              ? `url(${profile.backgroundURL})`
              : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />

        {/* Profile Content Section */}
        <div className="relative px-4 -mt-12">
          {/* Avatar overlapping the background */}
          <div className="mx-auto h-24 w-24 rounded-full border-4 border-white overflow-clip bg-white">
            <ProfilePicture className="h-full w-full" src={profile.avatarURL} />
          </div>

          {/* Profile Info */}
          <div className="mt-3 flex flex-col items-center">
            <div className="text-2xl font-medium px-8 break-words max-w-full text-center">
              {profile.name}
            </div>
            <div className="text-sm text-gray-500 font-mono text-center">
              {Models.PublicKey.toString(profile.system).slice(0, 10)}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 text-center w-full">
              {profile.isMyProfile == false ? (
                <>
                  <button
                    onClick={profile.iAmFollowing ? unfollow : follow}
                    className={`px-4 py-2 rounded-full ${
                      profile.iBlocked
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-500 text-white'
                    }`}
                    disabled={profile.iBlocked}
                  >
                    {profile.iAmFollowing ? 'Unfollow' : 'Follow'}
                  </button>
                  <button
                    onClick={profile.iBlocked ? unblock : block}
                    className={`px-4 py-2 rounded-full ${
                      profile.iAmFollowing
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-500 text-white'
                    }`}
                    disabled={profile.iAmFollowing}
                  >
                    {profile.iBlocked ? 'Unblock' : 'Block'}
                  </button>
                </>
              ) : (
                <button
                  className="border font-medium px-4 py-2 rounded-full col-span-2"
                  onClick={() => setEditProfileOpen(true)}
                >
                  Edit profile
                </button>
              )}
              <div>
                <button
                  onClick={() => setFollowingPanelOpen(true)}
                  className="text-gray-400"
                >
                  See Following
                </button>
              </div>
              <div>
                <button
                  onClick={() => setBlockedPanelOpen(true)}
                  className="text-gray-400"
                >
                  See Blocked
                </button>
              </div>
            </div>

            <div className="mt-4 text-gray-500 text-pretty px-8 break-words max-w-full prose prose-sm dark:prose-invert overflow-hidden">
              <ReactMarkdown>{truncatedDescription}</ReactMarkdown>
            </div>

            <ClaimGrid
              claims={claims}
              system={profile.system}
              isMyProfile={profile.isMyProfile}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
