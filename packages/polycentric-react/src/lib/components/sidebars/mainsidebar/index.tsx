import { NavLink } from 'react-router-dom'
import { AccountSwitcher } from '../../profile/AccountSwitcher'

export const MainSidebar = ({ topics }: { topics: string[] }) => (
  <div className="h-full w-full flex flex-col space-y-5 justify-between md:p-5">
    <div>
      <h1>Polycentric</h1>
      <div className="flex flex-col space-y-2 text-right">
        <NavLink to="/">All</NavLink>
        {topics.map((topic) => (
          <NavLink to={'/t' + topic} key={topic}>
            {topic}
          </NavLink>
        ))}
      </div>
    </div>
    <div>
      <AccountSwitcher />
    </div>
  </div>
)
