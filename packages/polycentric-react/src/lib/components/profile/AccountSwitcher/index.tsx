import { useState } from 'react'
import {} from '@headlessui/react'
import { Profile } from '../../../types/profile'

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
  switchAccount,
  currentProfile,
  profiles,
}: {
  switchAccount: any
  currentProfile: Profile
  profiles: Profile[]
}) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      {/* Border radius is 2rem because inner circle is 3rem with .5rem (p-2) padding both sides, so diameter=4 r=2rem */}
      <div className="rounded-[2rem] w-full flex flex-col p-2 border space-y-2">
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
                  <button className="h-[3rem] border p-1 rounded-full w-auto aspect-square flex justify-center items-center space-x-1">
                    {[0, 0, 0].map(() => (
                      <div className="w-1 h-1 rounded-full bg-gray-500"></div>
                    ))}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
