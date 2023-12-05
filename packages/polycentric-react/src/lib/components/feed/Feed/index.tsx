import { encode } from '@borderless/base64'
import useVirtual, { Item, ScrollTo } from '@polycentric/react-cool-virtual'
import { useEffect, useState } from 'react'
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks'
import { Post } from '../Post'

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

// For when you're providing your own outerref so the scroll area can be wider than just the feed
export const InnerFeed = ({
  innerRef,
  items,
  scrollTo,
  hasScrolled,
  data,
  topFeedComponent,
}: {
  innerRef: React.MutableRefObject<HTMLDivElement | null>
  items: Item[]
  scrollTo: ScrollTo
  hasScrolled: boolean
  data: FeedHookData
  topFeedComponent?: React.ReactNode
}) => {
  return (
    <div className="w-full lg:w-[700px] xl:w-[776px] relative  bg-white">
      {topFeedComponent}
      <div ref={innerRef} className="w-full lg:w-[700px] xl:w-[776px]" style={{ height: '100%' }}>
        {items.map(({ index, measureRef }) => (
          // You can set the item's height with the `size` property
          // TODO: change this to a proper index
          <Post
            ref={measureRef}
            // @ts-ignore
            // Typescript can't infer that data[index] is defined
            key={data[index] !== undefined ? encode(data[index].signedEvent.signature) : index}
            data={data[index]}
          />
        ))}
      </div>
      {hasScrolled && (
        <>
          <div className="absolute w-full top-1 md:top-5 flex justify-center z-40">
            <button
              onClick={() => scrollTo(0)}
              className="bg-blue-500 opacity-80 md:opacity-50 hover:opacity-80 border shadow rounded-full px-14 py-2 md:p-1 text-white fixed"
            >
              <UpArrowIcon />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export const Feed = ({ data, advanceFeed }: { data: FeedHookData; advanceFeed: FeedHookAdvanceFn }) => {
  const loadMoreCount = 20

  const { outerRef, innerRef, items, scrollTo } = useVirtual<HTMLDivElement>({
    itemCount: data.length,
    loadMoreCount,
    loadMore: () => advanceFeed(),
  })

  useEffect(() => {
    advanceFeed()
  }, [advanceFeed])

  const [hasScrolled, setHasScrolled] = useState(false)

  return (
    <div
      ref={outerRef}
      className="h-full w-full overflow-auto flex noscrollbar"
      onScroll={(e) => {
        if (e.currentTarget.scrollTop > 400 && !hasScrolled) {
          setHasScrolled(true)
        } else if (e.currentTarget.scrollTop <= 100 && hasScrolled) {
          setHasScrolled(false)
        }
      }}
    >
      <InnerFeed data={data} innerRef={innerRef} items={items} scrollTo={scrollTo} hasScrolled={hasScrolled} />
    </div>
  )
}
