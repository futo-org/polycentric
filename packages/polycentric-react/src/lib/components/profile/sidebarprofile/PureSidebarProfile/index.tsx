import { Models, Protocol } from '@polycentric/polycentric-core';
import { useState } from 'react';
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
    description?: string;
    followerCount?: number;
    followingCount?: number;
    isMyProfile: boolean;
    iAmFollowing?: boolean;
    iBlocked?: boolean;
    system: Models.PublicKey.PublicKey;
}

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
    claims: { value: Protocol.Claim; pointer: Protocol.Reference }[];
}) => {
    const [editProfileOpen, setEditProfileOpen] = useState(false);
    const [followingPanelOpen, setFollowingPanelOpen] = useState(false);
    const [blockedPanelOpen, setBlockedPanelOpen] = useState(false);
    return (
        <div className="w-full h-full">
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
            <div className="flex flex-col items-center justify-center space-y-3">
                <ProfilePicture className="h-24 w-24" src={profile.avatarURL} />
                <div className="text-2xl font-medium px-8 break-words max-w-full text-center">
                    {profile.name}
                </div>
                <div className="grid grid-cols-2 gap-4 text-center">
                    {profile.isMyProfile == false ? (
                        <>
                            <button
                                onClick={
                                    profile.iAmFollowing ? unfollow : follow
                                }
                                className="bg-blue-500 text-white px-4 py-2 rounded-full"
                            >
                                {profile.iAmFollowing ? 'Unfollow' : 'Follow'}
                            </button>
                            <button
                                onClick={profile.iBlocked ? unblock : block}
                                className="bg-blue-500 text-white px-4 py-2 rounded-full"
                            >
                                {profile.iBlocked ? 'Unblock' : 'Block'}
                            </button>
                        </>
                    ) : (
                        <button
                            className="border font-medium  px-4 py-2 rounded-full col-span-2"
                            onClick={() => setEditProfileOpen(true)}
                        >
                            Edit profile
                        </button>
                    )}
                    <div className="">
                        <button
                            onClick={() => setFollowingPanelOpen(true)}
                            className="text-gray-400"
                        >
                            See Following
                        </button>
                    </div>
                    <div className="">
                        <button
                            onClick={() => setBlockedPanelOpen(true)}
                            className="text-gray-400"
                        >
                            See Blocked
                        </button>
                    </div>
                </div>
                <div className="text-gray-500 text-pretty px-8 break-words max-w-full">
                    {profile.description}
                </div>
                <ClaimGrid claims={claims} system={profile.system} />
            </div>
        </div>
    );
};
