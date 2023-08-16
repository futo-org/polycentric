import React, { useEffect, useRef, useState } from 'react'
import useVirtual from 'react-cool-virtual'
import { Profile } from '../../../types/profile'
import { PurePost } from '../PurePost'
import { Compose } from '../Compose'

interface PostProps {
  content: string
  author: Profile
  publishedAt: Date
  topic: string
  image?: string
}

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

export const DummyScrollFeed = ({ p, children }: { p: ReadonlyArray<{ main?: PostProps; sub?: PostProps }> }) => {
  const { outerRef, innerRef, items, scrollTo } = useVirtual<HTMLDivElement>({
    itemCount: 100, // Provide the total number for the list items
  })

  const [showScrollButton, setShowScrollButton] = useState(false)

  return (
    <div
      // @ts-ignore
      ref={outerRef} // Attach the `outerRef` to the scroll container
      className="h-full overflow-auto flex"
      onScroll={(e) => {
        if (e.currentTarget.scrollTop > 400 && !showScrollButton) {
          setShowScrollButton(true)
        } else if (e.currentTarget.scrollTop <= 100 && showScrollButton) {
          setShowScrollButton(false)
        }
      }}
    >
      <div className="w-full xl:w-[640px] relative">
        {/* Attach the `innerRef` to the wrapper of the items */}
        {/* //@ts-ignore */}

        <div className="p-10 border-b-2">
          <Compose />
        </div>
        <div ref={innerRef} className="w-full xl:w-[640px]" style={{ height: '100%' }}>
          {items.map(({ index, size, measureRef }) => (
            // You can set the item's height with the `size` property
            <PurePost ref={measureRef} key={index} main={p[index % 5].main} sub={p[index % 5].sub} />
          ))}
        </div>
        {showScrollButton && (
          <div className="absolute w-full top-1 md:top-5 flex justify-center z-40">
            <button
              onClick={() => scrollTo(0)}
              className="bg-blue-500 opacity-80 md:opacity-50 hover:opacity-80 border shadow rounded-full px-14 py-2 md:p-1 text-white fixed"
            >
              <UpArrowIcon />
            </button>
          </div>
        )}
      </div>
      <div className="h-full sticky top-0 border hidden md:block md:w-[15rem] xl:w-[320px]">{children}</div>
    </div>
  )
}
