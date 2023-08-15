import React, { useRef } from 'react'
import useVirtual from 'react-cool-virtual'
import { Profile } from '../../../types/profile'
import { PurePost } from '../PurePost'

interface PostProps {
  content: string
  author: Profile
  publishedAt: Date
  topic: string
}

export const DummyScrollFeed = ({ p }: { p: ReadonlyArray<PostProps> }) => {
  const { outerRef, innerRef, items } = useVirtual<HTMLDivElement>({
    itemCount: 100, // Provide the total number for the list items
  })

  return (
    <div
      // @ts-ignore
      ref={outerRef} // Attach the `outerRef` to the scroll container
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    >
      {/* Attach the `innerRef` to the wrapper of the items */}
      {/* //@ts-ignore */}
      <div ref={innerRef}>
        {items.map(({ index, size, measureRef }) => (
          // You can set the item's height with the `size` property
          <PurePost ref={measureRef} key={index} main={p[index % 2]} />
        ))}
      </div>
    </div>
  )
}
