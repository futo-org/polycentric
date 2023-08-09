import { Profile } from '../../../types/profile'

export const PureFollowerListItem = ({ profile }: { profile: Profile }) => (
  <div className="w-full flex px-5 md:px-10 py-5 space-x-4 bg-white hover:bg-gray-50">
    <div>
        <img src={profile.avatarURL} className='h-10 w-10 rounded-full'/>
    </div>
    <div className="flex flex-col">
        <p className='font-medium'>
            {profile.name}
        </p>
        <p>
            {profile.description}
        </p>
    </div>
  </div>
)
