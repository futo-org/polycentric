import { Profile } from '../../../types/profile'
import { NavLink } from 'react-router-dom'

export const MainSidebar = ({ topics, profile }: { topics: string[]; profile: Profile }) => (
  <div className="h-full w-full flex flex-col space-y-5">
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
)
