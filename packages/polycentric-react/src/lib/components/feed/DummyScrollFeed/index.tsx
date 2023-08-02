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
  const { outerRef, innerRef, items } = useVirtual({
    itemCount: 50, // Provide the total number for the list items
  })

  return (
    <div
      // @ts-ignore
      ref={outerRef} // Attach the `outerRef` to the scroll container
      style={{ width: '100%', height: '100%', overflow: 'auto' }}
    >
      {/* Attach the `innerRef` to the wrapper of the items */}
      {/* //@ts-ignore */}
      <div ref={innerRef}>
        {items.map(({ index, size, measureRef }) => (
          // You can set the item's height with the `size` property
          <Post
            ref={measureRef}
            key={index}
            author={p[index % 2].author}
            content={p[index % 2].content}
            publishedAt={p[index % 2].publishedAt}
            topic={p[index % 2].topic}
          />
        ))}
      </div>
    </div>
  )
}
