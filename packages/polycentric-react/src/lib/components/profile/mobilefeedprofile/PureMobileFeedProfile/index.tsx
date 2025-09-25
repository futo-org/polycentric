/**
 * @fileoverview Pure mobile feed profile display component.
 */

import { ArrowUpOnSquareIcon } from '@heroicons/react/24/outline';
import { Models, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ClaimGrid } from '../../ClaimGrid';
import {
  EditProfileActions,
  PureEditProfile,
} from '../../edit/PureEditProfile';
import { FollowingList } from '../../FollowingList';
import { PureSidebarProfileData } from '../../sidebarprofile/PureSidebarProfile';

// Mobile profile display with background, avatar, and action buttons
export const PureMobileFeedProfile = ({
  profile,
  follow,
  unfollow,
  block,
  unblock,
  share,
  editProfileActions,
  claims,
}: {
  profile: PureSidebarProfileData;
  follow: () => void;
  unfollow: () => void;
  block: () => void;
  unblock: () => void;
  share: () => void;
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

  // Truncate description to 256 characters to match the edit form limit
  const truncatedDescription = useMemo(() => {
    if (!profile.description) return '';
    return profile.description.length > 256
      ? profile.description.slice(0, 256) + '...'
      : profile.description;
  }, [profile.description]);

  return (
    <div className="border-b">
      <PureEditProfile
        profile={profile}
        actions={editProfileActions}
        open={editProfileOpen}
        setOpen={setEditProfileOpen}
      />
      <FollowingList
        system={profile.system}
        open={followingPanelOpen}
        setOpen={setFollowingPanelOpen}
      />
      <div className="relative">
        {/* Background Image Section */}
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
          <div className="h-24 w-24 rounded-full border-4 border-white overflow-clip bg-white">
            <img
              src={profile.avatarURL}
              className="h-full w-full object-cover"
              alt="Profile avatar"
            />
          </div>

          {/* Profile Info */}
          <div className="mt-3">
            <div className="flex flex-wrap items-start justify-between">
              <div className="flex flex-col">
                <div className="text-2xl font-medium self-center max-w-full break-words">
                  {profile.name}
                </div>
                <div className="text-sm text-gray-500 font-mono">
                  {Models.PublicKey.toString(profile.system).slice(0, 10)}
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                {profile.isMyProfile ? (
                  <button
                    className="bg-gray-50 text-gray-700 border text-sm px-4 py-2 rounded-full"
                    onClick={() => setEditProfileOpen(true)}
                  >
                    Edit profile
                  </button>
                ) : (
                  <>
                    <button
                      className={`px-4 py-2 rounded-full ${
                        profile.iBlocked
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-500 text-white'
                      }`}
                      onClick={() => {
                        profile.iAmFollowing ? unfollow() : follow();
                      }}
                      disabled={profile.iBlocked}
                    >
                      {profile.iAmFollowing ? 'Unfollow' : 'Follow'}
                    </button>
                    <button
                      className={`px-4 py-2 rounded-full ${
                        profile.iAmFollowing
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-500 text-white'
                      }`}
                      onClick={() => {
                        profile.iBlocked ? unblock() : block();
                      }}
                      disabled={profile.iAmFollowing}
                    >
                      {profile.iBlocked ? 'Unblock' : 'Block'}
                    </button>
                  </>
                )}
                <button
                  onClick={share}
                  className="bg-gray-50 text-gray-500 h-10 w-10 flex justify-center items-center rounded-full border"
                >
                  <ArrowUpOnSquareIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            <button
              onClick={() => setFollowingPanelOpen(true)}
              className="mt-4 text-gray-600"
            >
              See following
            </button>

            <div className="mt-4 text-gray-600 min-w-0 break-words overflow-hidden">
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
