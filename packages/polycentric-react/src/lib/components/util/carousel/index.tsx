import { Transition } from '@headlessui/react' // Make sure to install @headlessui/react and its types if using this
import React from 'react'

const LeftArrow = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-8 h-8"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
)

const RightArrow = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-8 h-8"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
  </svg>
)

// Assumes that components will just modify application setting state so no direct state sharing is needed between components
// Takes in an array of component types that take in a nextSlide function

export const Carousel = ({
  childComponents,
  itemClassName,
}: {
  childComponents: (({ nextSlide }: { nextSlide: () => void }) => JSX.Element)[]
  itemClassName: string
}) => {
  const [currentSlide, setCurrentSlide] = React.useState(0)
  const [maxVisitedSlide, setMaxVisitedSlide] = React.useState(0)

  return (
    <div className="flex flex-col space-y-3">
      <div className="w-full flex md:space-x-3 md:items-end">
        <button
          className={`hidden md:flex w-20 h-20 rounded-full bg-white border justify-center items-center ${
            currentSlide > 0 ? '' : 'invisible'
          }`}
          onClick={() => {
            if (currentSlide > 0) {
              setCurrentSlide(currentSlide - 1)
            }
          }}
        >
          <LeftArrow />
        </button>
        <div className={'flex-grow md:border rounded-[2.5rem] relative overflow-hidden ' + itemClassName}>
          {childComponents.map((Child, i) => (
            <Transition
              key={i}
              show={i === currentSlide}
              enter="transition-opacity duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
              className="absolute top-0"
            >
              <Child
                nextSlide={() => {
                  if (currentSlide < childComponents.length - 1) {
                    setCurrentSlide(currentSlide + 1)
                    setMaxVisitedSlide(Math.max(currentSlide + 1, maxVisitedSlide))
                  }
                }}
              />
            </Transition>
          ))}
          <button
            className={`hidden md:flex w-20 h-20 rounded-full bg-white border justify-center items-center ${
              currentSlide < maxVisitedSlide ? '' : 'invisible'
            }`}
            onClick={() => {
              if (currentSlide < childComponents.length - 1 && currentSlide < maxVisitedSlide) {
                setCurrentSlide(currentSlide + 1)
                setMaxVisitedSlide(Math.max(currentSlide + 1, maxVisitedSlide))
              }
            }}
          >
            <RightArrow />
          </button>
        </div>
        <div className="md:hidden flex space-x-5 justify-between">
          <button
            className={`md:hidden flex w-20 h-20 rounded-full bg-white border justify-center items-center ${
              currentSlide > 0 ? '' : 'invisible'
            }`}
            onClick={() => {
              if (currentSlide > 0) {
                setCurrentSlide(currentSlide - 1)
              }
            }}
          >
            <LeftArrow />
          </button>
          <button
            className={`md:hidden flex w-20 h-20 rounded-full bg-white border justify-center items-center ${
              currentSlide < maxVisitedSlide ? '' : 'invisible'
            }`}
            onClick={() => {
              if (currentSlide < childComponents.length - 1 && currentSlide < maxVisitedSlide) {
                setCurrentSlide(currentSlide + 1)
                setMaxVisitedSlide(Math.max(currentSlide + 1, maxVisitedSlide))
              }
            }}
          >
            <RightArrow />
          </button>
        </div>
      </div>
    </div>
  )
}
