import { useState } from 'react'
import { ProfilePicture } from '../../ProfilePicture'
import { EditProfileActions, PureEditProfile } from '../../edit/PureEditProfile'
import { PureSidebarProfileData } from '../../sidebarprofile/PureSidebarProfile'

const ElipsesIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-6 h-6"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
    />
  </svg>
)

export const PureMobileFeedProfile = ({
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
    <div className="border-b">
      <PureEditProfile
        profile={profile}
        actions={editProfileActions}
        open={editProfileOpen}
        setOpen={setEditProfileOpen}
      />
      <div className="p-4 mb-4 bg-gray-50 bg-cover bg-center" style={{ backgroundImage: profile.backgroundURL }}>
        <ProfilePicture src={profile.avatarURL} className="w-24 h-24" />
      </div>
      <div className="grid grid-cols-2 gap-4 px-4">
        <div className="text-2xl font-medium self-center">{profile.name}</div>
        <div className="col-start-2 flex items-end">
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
                profile.iAmFollowing ? unfollow() : follow()
              }}
            >
              {profile.iAmFollowing ? 'Unfollow' : 'Follow'}
            </button>
          )}
          <button className="bg-gray-50 text-gray-500 h-full flex justify-center items-center rounded-full ml-2 border aspect-square">
            <ElipsesIcon />
          </button>
        </div>
        <div className="col-span-1 flex flex-col justify-center">
          <p>
            <span className="font-bold">{profile.followerCount ?? 0}</span> followers
          </p>
        </div>
        <div className="col-span-1 flex flex-col justify-center">
          <p>
            <span className="font-bold">{profile.followingCount ?? 0}</span> following
          </p>
        </div>
        <div className="col-span-2 text text-gray-500">{profile.description}</div>
      </div>
    </div>
  )
}
