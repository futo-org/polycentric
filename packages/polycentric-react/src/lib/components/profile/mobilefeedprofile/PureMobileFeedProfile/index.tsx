import { Protocol } from '@polycentric/polycentric-core';
import { ArrowUpOnSquareIcon } from '@heroicons/react/24/outline';
import { Models } from '@polycentric/polycentric-core';
import { useState } from 'react';
import { FollowingList } from '../../FollowingList';
import { ClaimGrid } from '../../ClaimGrid';
import {
    EditProfileActions,
    PureEditProfile,
} from '../../edit/PureEditProfile';
import { PureSidebarProfileData } from '../../sidebarprofile/PureSidebarProfile';

export const PureMobileFeedProfile = ({
    profile,
    follow,
    unfollow,
    share,
    editProfileActions,
    claims,
}: {
    profile: PureSidebarProfileData;
    follow: () => void;
    unfollow: () => void;
    share: () => void;
    editProfileActions: EditProfileActions;
    claims: { value: Protocol.Claim; pointer: Protocol.Reference }[];
}) => {
    const [editProfileOpen, setEditProfileOpen] = useState(false);
    const [followingPanelOpen, setFollowingPanelOpen] = useState(false);

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
            <div className="grid grid-cols-2 gap-4 px-4 pt-4">
                <div className="col-span-2 ">
                    <div className="h-24 w-24 rounded-full border overflow-clip">
                        <img src={profile.avatarURL} className="" />
                    </div>
                </div>
            </div>
            <div className="w-full mt-6 mb-4"></div>
            <div className="flex gap-4 px-4 pb-4 flex-wrap">
                <div className="flex flex-col">
                    <div className="text-2xl font-medium self-center max-w-full break-words">
                        {profile.name}
                    </div>
                    <div className="text-sm text-gray-500 font-mono">
                        {Models.PublicKey.toString(profile.system).slice(0, 6)}
                    </div>
                </div>
                <div className="w-1/2 flex items-end ml-auto">
                    {profile.isMyProfile ? (
                        <button
                            className="bg-gray-50 text-gray-700 border text-sm px-4 py-2 rounded-full flex-grow"
                            onClick={() => setEditProfileOpen(true)}
                        >
                            Edit profile
                        </button>
                    ) : (
                        <button
                            className="bg-blue-500 text-white px-4 py-2 rounded-full flex-grow"
                            onClick={() => {
                                profile.iAmFollowing ? unfollow() : follow();
                            }}
                        >
                            {profile.iAmFollowing ? 'Unfollow' : 'Follow'}
                        </button>
                    )}
                    <button
                        onClick={share}
                        className="bg-gray-50 text-gray-500 h-full flex justify-center items-center rounded-full ml-2 border aspect-square"
                    >
                        <ArrowUpOnSquareIcon className="w-6 h-6" />
                    </button>
                </div>
                <div className="w-1/2">
                    <button onClick={() => setFollowingPanelOpen(true)}>
                        See following
                    </button>
                </div>
                <div className="flex flex-col justify-center">
                    {/* <p>
                        <span className="font-bold">
                            {profile.followerCount ?? 0}
                        </span>{' '}
                        followers
                    </p> */}
                </div>
                <div className="w-full text text-gray-500 min-w-0 break-words">
                    {profile.description}
                </div>
                <ClaimGrid claims={claims} system={profile.system} />
            </div>
        </div>
    );
};
