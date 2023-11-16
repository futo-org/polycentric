import useVirtual, { Item, ScrollTo } from '@polycentric/react-cool-virtual'
import { ReactNode, useEffect, useState } from 'react'
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks'
import { useIsMobile } from '../../../hooks/styleHooks'
import { InnerFeed } from '../../feed/Feed'
import { SearchBox } from '../../search/searchbox'

interface InfiniteScrollFeedProps {
  innerRef: React.MutableRefObject<HTMLDivElement | null>
  items: Item[]
  hasScrolled: boolean
  scrollTo: ScrollTo
  data: FeedHookData[]
}

export type InfiniteScrollFeed = (props: InfiniteScrollFeedProps) => ReactNode

export const InfiniteScrollWithRightCol = ({
  data,
  advanceFeed,
  leftCol,
  topFeedComponent,
}: {
  data: FeedHookData
  advanceFeed: FeedHookAdvanceFn
  leftCol: ReactNode
  topFeedComponent?: ReactNode
}) => {
  const loadMoreCount = 20

  const { outerRef, innerRef, items, scrollTo } = useVirtual<HTMLDivElement>({
    itemCount: data.length,
    loadMoreCount,
    loadMore: () => advanceFeed(),
    overscanCount: 5,
  })

  const [hasScrolled, setHasScrolled] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    advanceFeed()
  }, [advanceFeed])

  return (
    <div
      // @ts-ignore
      ref={outerRef} // Attach the `outerRef` to the scroll container
      className="h-full overflow-auto flex noscrollbar"
      onScroll={(e) => {
        if (e.currentTarget.scrollTop > 400 && !hasScrolled) {
          setHasScrolled(true)
        } else if (e.currentTarget.scrollTop <= 100 && hasScrolled) {
          setHasScrolled(false)
        }
      }}
    >
      <div className="w-full lg:w-[700px] xl:w-[776px] relative">
        <InnerFeed
          innerRef={innerRef}
          items={items}
          data={data}
          scrollTo={scrollTo}
          hasScrolled={hasScrolled}
          topFeedComponent={topFeedComponent}
        />
      </div>
      {isMobile ? (
        <div />
      ) : (
        <div className="h-full sticky top-0 border-x hidden xl:block xl:w-[calc((100vw-776px)/2)] 2xl:w-[calc((1536px-776px)/2)] 2xl:mr-[calc((100vw-1536px)/2)] ">
          <div className="p-5">
            <SearchBox />
          </div>
          {leftCol}
        </div>
      )}
    </div>
  )
}
