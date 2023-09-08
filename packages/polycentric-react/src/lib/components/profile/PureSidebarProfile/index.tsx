import { Profile } from '../../../types/profile'

export const PureSidebarProfile = ({ profile }: { profile: Profile }) => (
  <div className="w-full h-full">
    <div className="flex flex-col items-center justify-center space-y-3">
      <img src={profile.avatarURL} className="h-24 w-24 rounded-full" />
      <div className="text-2xl font-medium">{profile.name}</div>
      <div className="flex space-x-2">
        <p>
          <span className="font-bold">{390}</span> followers
        </p>
        <p>
          <span className="font-bold">{30}</span> following
        </p>
      </div>
      <div className="text text-gray-500">{profile.description}</div>
    </div>
  </div>
)
