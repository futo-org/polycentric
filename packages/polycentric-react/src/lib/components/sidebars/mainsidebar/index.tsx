import { Profile } from '../../../types/profile'
import { NavLink } from 'react-router-dom'
import { AccountSwitcher, AccountSwitcherReverse } from '../../profile/AccountSwitcher'

export const MainSidebar = ({ topics, profile }: { topics: string[]; profile: Profile }) => (
  <div className="h-full w-full flex flex-col space-y-5 justify-between md:p-5">
    <div>
      <h1>Polycentric</h1>
      <div className="flex flex-col space-y-2 text-right">
        <NavLink to="/" className={({ isActive }) => ''}>
          All
        </NavLink>
        {topics.map((topic) => (
          <NavLink to={'/t' + topic} className={({ isActive }) => ''}>
            {topic}
          </NavLink>
        ))}
      </div>
    </div>
    <div>
      <AccountSwitcherReverse
        currentProfile={{
          name: 'John Doe',
          avatarURL: 'https://i.pravatar.cc/300',
          description: 'i like to repair. i like to repair. i like to repair. ',
        }}
      />
    </div>
  </div>
)
