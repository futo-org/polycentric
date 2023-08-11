import React, { ReactNode } from 'react'
import { Transition } from '@headlessui/react' // Make sure to install @headlessui/react and its types if using this

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

export const Carousel = ({
  childComponents,
}: {
  childComponents: (({ nextSlide }: { nextSlide: () => void }) => JSX.Element)[]
}) => {
  const [currentSlide, setCurrentSlide] = React.useState(0)
  const [maxVisitedSlide, setMaxVisitedSlide] = React.useState(0)

  return (
    <div className="w-full flex items-end space-x-5">
      <button
        className={`w-20 h-20 rounded-full bg-white border flex justify-center items-center ${
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
      <div className="relative  flex-grow min-h-[30rem] border rounded-[2.5rem] overflow-hidden">
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
          >
            <div className="absolute inset-0">
              <br/>
              <br/>
              <br/>
              {currentSlide}
              {maxVisitedSlide}
              <Child
                nextSlide={() => {
                  if (currentSlide < childComponents.length - 1) {
                    setCurrentSlide(currentSlide + 1)
                    setMaxVisitedSlide(Math.max(currentSlide + 1, maxVisitedSlide))
                  }
                }}
              />
            </div>
          </Transition>
        ))}
      </div>
      <button
        className={`w-20 h-20 rounded-full bg-white border flex justify-center items-center ${
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
      </button>{' '}
    </div>
  )
}
