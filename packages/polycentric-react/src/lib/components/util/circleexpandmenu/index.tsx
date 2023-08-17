import { useState } from 'react'

export const CircleExpandMenu = () => {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="relative">
      <div
        className={`absolute rounded-[1.5rem] border top-0 right-0 bg-white ${expanded ? 'z-10' : ''} overflow-hidden`}
      >
        <div className={`flex justify-between items-center w-full ${expanded ? 'rounded-br-[1.5rem] border-b' : ''}`}>
          {expanded && <h3 className="font-medium pl-5">Account</h3>}
          <button
            className={`h-[3rem] float-right rounded-full w-auto aspect-square flex justify-center items-center space-x-1 ${
              expanded ? 'bg-gray-100' : ''
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            {(expanded ? [2, 2, 2] : [3, 3, 3]).map(() => (
              <div className="w-1 h-1 rounded-full bg-gray-500"></div>
            ))}
          </button>
        </div>
        {expanded && (
          <div className="w-[15rem]">
            <button className="h-[3rem] px-5 flex items-center hover:bg-gray-50 w-full">Switch To</button>
            <button className="h-[3rem] px-5 flex items-center hover:bg-gray-50 w-full">Sign Out</button>
          </div>
        )}
      </div>
    </div>
  )
}
