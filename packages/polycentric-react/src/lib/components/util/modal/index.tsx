import { useState } from 'react'

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
    <path
      fillRule="evenodd"
      d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
      clipRule="evenodd"
    />
  </svg>
)

export const EmptyModal = ({
  children,
  setOpen,
}: {
  children: React.ReactNode
  setOpen: (open: boolean) => void
}): JSX.Element => (
  <div
    className="absolute top-0 left-0 w-screen h-screen backdrop-blur-md z-40 flex flex-col items-center md:justify-center"
    onClick={() => setOpen(false)}
  >
    {children}
  </div>
)

export const Modal = ({
  children,
  setOpen,
}: {
  children: React.ReactNode
  setOpen: (open: boolean) => void
}): JSX.Element => {
  return (
    <EmptyModal setOpen={setOpen}>
      <div
        className="bg-white m-5 md:m-7 md:rounded-xl md:border h-full md:h-auto"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div className="flex justify-end px-3">
          <button
            className="flex items-center rounded-full hover:bg-gray-50 border p-2"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </EmptyModal>
  )
}
