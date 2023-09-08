import { Menu } from '@headlessui/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Profile } from '../../../types/profile'
import { CircleExpandMenu, CircleExpandMenuReverse } from '../../util/circleexpandmenu'

const UpArrowIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-6 h-6"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75" />
  </svg>
)

export const AccountSwitcher = ({
  currentProfile,
}: {
  switchAccount: () => void
  currentProfile: Profile
  profiles: Profile[]
}) => {
  const [expanded, setExpanded] = useState(false)
  const [subMenuExpanded, setSubMenuExpanded] = useState(false)

  return (
    <Menu as="div" className="relative">
      {/* Border radius is 2rem because inner circle is 3rem with .5rem (p-2) padding both sides, so diameter=4 r=2rem */}
      <div
        className={`rounded-[2rem] w-full flex flex-col p-2 border space-y-2 absolute ${
          subMenuExpanded
            ? 'after:rounded-[2rem] after:bg-black after:bg-opacity-25 after:absolute after:inset-0 after:block after:bg-transparent'
            : ''
        }`}
      >
        <div className="flex justify-between w-full">
          <div className="flex space-x-2">
            <div className="h-[3rem] rounded-full w-auto aspect-square border"></div>
            <div className="flex flex-col">
              <p className="bold text-normal">{currentProfile.name}</p>
              <p className="font-light text-gray-400">fhsioqui29180a</p>
            </div>
          </div>
          <button
            className={`h-[3rem] bg-gray-50 p-1 rounded-full w-auto aspect-square flex justify-center items-center ${
              expanded ? ' scale-y-100' : '-scale-y-100'
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            <UpArrowIcon />
          </button>
        </div>
        {expanded && (
          <>
            <div className="w-full border-b"></div>
            <Menu.Items static={true}>
              <div className="flex flex-col space-y-3">
                {[2, 2, 3].map(() => (
                  <div className="flex justify-between w-full">
                    <div className="flex space-x-2">
                      <div className="h-[3rem] rounded-full w-auto aspect-square border"></div>
                      <div className="flex flex-col">
                        <p className="bold text-normal">{currentProfile.name}</p>
                        <p className="font-light text-gray-400">fhsioqui29180a</p>
                      </div>
                    </div>
                    <CircleExpandMenu onIsOpenChange={(isOpen) => setSubMenuExpanded(isOpen)} />
                  </div>
                ))}
              </div>
            </Menu.Items>
          </>
        )}
      </div>
    </Menu>
  )
}

export const AccountSwitcherReverse = ({
  currentProfile,
}: {
  switchAccount?: () => void
  currentProfile: Profile
  profiles: Profile[]
}) => {
  const [expanded, setExpanded] = useState(false)
  const [subMenuExpanded, setSubMenuExpanded] = useState(false)

  return (
    <Menu as="div" className="relative">
      {/* Border radius is 2rem because inner circle is 3rem with .5rem (p-2) padding both sides, so diameter=4 r=2rem */}
      <div
        className={`rounded-[2rem] w-full flex flex-col border bottom-0 absolute ${
          subMenuExpanded ? 'after:rounded-[2rem] after:backdrop-blur-lg after:absolute after:inset-0 after:block' : ''
        }`}
      >
        {expanded && (
          <>
            <Menu.Items static={true}>
              <div className="flex flex-col">
                {[2, 2, 3].map(() => (
                  <div className="flex justify-between w-full p-2">
                    <div className="flex space-x-2">
                      <img
                        className="h-[3rem] rounded-full w-auto aspect-square border"
                        src={currentProfile.avatarURL}
                      />
                      <div className="flex flex-col">
                        <p className="bold text-normal">{currentProfile.name}</p>
                        <p className="font-light text-gray-400">fhsioqui29180a</p>
                      </div>
                    </div>
                    <CircleExpandMenuReverse
                      title={currentProfile.name}
                      onIsOpenChange={(isOpen) => setSubMenuExpanded(isOpen)}
                    />
                  </div>
                ))}
              </div>
            </Menu.Items>
            <div className="w-full border-b m-0"></div>
          </>
        )}
        <div className={`flex justify-between p-2 w-full ${expanded ? 'rounded-b-[2rem]' : 'rounded-[2rem]'}`}>
          <div className="flex space-x-2">
            <Link to="">
              <img className="h-[3rem] rounded-full w-auto aspect-square border" src={currentProfile.avatarURL} />
            </Link>
            <div className="flex flex-col">
              <p className="bold text-normal">{currentProfile.name}</p>
              <p className="font-light text-gray-400">fhsioqui29180a</p>
            </div>
          </div>
          <button
            className={`h-[3rem] bg-gray-50 p-1 rounded-full w-auto aspect-square flex justify-center items-center ${
              expanded ? ' -scale-y-100' : 'scale-y-100'
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            <UpArrowIcon />
          </button>
        </div>
      </div>
    </Menu>
  )
}
