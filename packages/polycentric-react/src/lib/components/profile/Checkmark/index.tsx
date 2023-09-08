import { useState } from 'react'

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-6 h-6"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
)

export type VouchedByState = {
  avatar: string
  username: string
  link: string
}

export const Checkmark = ({ vouchPeople }: { vouchPeople: ReadonlyArray<VouchedByState> }) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className={`group flex overflow-x-hidden rounded-full bg-blue-500 color-white pl-2 py-1 h-10 items-center transition-[max-width] w-full ${
        expanded ? 'max-w-[20rem]' : 'max-w-[2.5rem] hover:max-w-[3rem]'
      }`}
    >
      <CheckIcon />
      <div className={`hidden group-hover:flex`}>
        {vouchPeople.map((p, i) => (
          <div key={i} className="flex items-center">
            <img src={p.avatar} alt={p.username} className="w-6 h-6 rounded-full border-2 border-white" />
          </div>
        ))}
      </div>
    </button>
  )
}
