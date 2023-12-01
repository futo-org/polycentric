import { useState } from 'react'
import { EditProfileActions, PureEditProfile } from '../../edit/PureEditProfile'

export interface PureSidebarProfileData {
  name?: string
  avatarURL?: string
  description?: string
  followerCount?: number
  followingCount?: number
  isMyProfile: boolean
  iAmFollowing?: boolean
}

export const PureSidebarProfile = ({
  profile,
  follow,
  unfollow,
  editProfileActions,
}: {
  profile: PureSidebarProfileData
  follow: () => void
  unfollow: () => void
  editProfileActions: EditProfileActions
}) => {
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  return (
    <div className="w-full h-full">
      <PureEditProfile
        open={editProfileOpen}
        setOpen={setEditProfileOpen}
        profile={profile}
        actions={editProfileActions}
      />
      <div className="flex flex-col items-center justify-center space-y-3">
        <div className="h-24 w-24 rounded-full border overflow-clip">
          <img src={profile.avatarURL} className="" />
        </div>
        <div className="text-2xl font-medium">{profile.name}</div>
        {profile.isMyProfile == false ? (
          <button
            onClick={profile.iAmFollowing ? unfollow : follow}
            className="bg-blue-500 text-white px-4 py-2 rounded-full"
          >
            {profile.iAmFollowing ? 'Unfollow' : 'Follow'}
          </button>
        ) : (
          <button className="border font-medium  px-4 py-2 rounded-full" onClick={() => setEditProfileOpen(true)}>
            Edit profile
          </button>
        )}
        <div className="flex space-x-2">
          <p>
            <span className="font-bold">{profile.followerCount}</span> followers
          </p>
          <p>
            <span className="font-bold">{profile.followingCount}</span> following
          </p>
        </div>
        <div className="text text-gray-500">{profile.description}</div>
      </div>
    </div>
  )
}
