import { encode } from '@borderless/base64'
import { ArrowUpIcon } from '@heroicons/react/24/outline'
import { ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks'
import { useIsMobile } from '../../../hooks/styleHooks'
import { Post } from '../../feed'
import { SearchBox } from '../../search/searchbox'

export const InfiniteScrollWithRightCol = ({
  data,
  advanceFeed,
  leftCol,
  topFeedComponent,
  prependCount,
}: {
  data: FeedHookData
  advanceFeed: FeedHookAdvanceFn
  leftCol?: ReactElement
  topFeedComponent?: ReactElement
  prependCount?: number
}) => {
  const outerRef = useRef<HTMLDivElement>(null)
  const [showScrollUpButton, setShowScrollUpButton] = useState(false)
  const hasScrolled = useRef(false)
  const isMobile = useIsMobile()

  const [windowHeight] = useState(window.innerHeight)

  useEffect(() => {
    advanceFeed()
  }, [advanceFeed])

  const virtuoso = useRef<VirtuosoHandle>(null)

  useLayoutEffect(() => {
    if (prependCount && prependCount > 0) {
      if (hasScrolled.current === false) {
        virtuoso.current?.scrollToIndex(prependCount)
        setShowScrollUpButton(true)
      }
    }
  }, [prependCount])

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (hasScrolled.current === false) {
        hasScrolled.current = true
      }
      if (e.currentTarget.scrollTop > 200 && !showScrollUpButton) {
        setShowScrollUpButton(true)
      } else if (e.currentTarget.scrollTop <= 100 && showScrollUpButton) {
        setShowScrollUpButton(false)
      }
    },
    [showScrollUpButton],
  )

  return (
    <div
      ref={outerRef} // Attach the `outerRef` to the scroll container as the custom scroll parent so it includes the left column and the padding
      className="h-full flex overflow-y-scroll noscrollbar"
      onScroll={isMobile ? undefined : onScroll}
    >
      <div className="w-full lg:w-[700px] xl:w-[776px] relative">
        <Virtuoso
          ref={virtuoso}
          data={data}
          className="noscrollbar"
          style={{ height: '100%' }}
          customScrollParent={isMobile ? undefined : outerRef.current ?? undefined}
          onScroll={isMobile ? onScroll : undefined}
          itemContent={(index, data) => (
            <Post
              key={data !== undefined ? encode(data.signedEvent.signature) : index}
              autoExpand={prependCount !== undefined && index === 100 - prependCount}
              data={data}
            />
          )}
          overscan={{
            reverse: windowHeight * 5,
            main: windowHeight * 10,
          }}
          increaseViewportBy={{
            top: windowHeight / 2,
            bottom: windowHeight / 2,
          }}
          endReached={() => advanceFeed()}
          components={{
            Header: topFeedComponent ? () => topFeedComponent : undefined,
            Footer: prependCount !== undefined ? () => <div className="h-[200vh]" /> : undefined,
          }}
        />
        {showScrollUpButton && (
          <>
            <div className="absolute w-full top-1 md:top-5 flex justify-center z-40">
              <button
                onClick={() => virtuoso.current?.scrollTo({ top: 0, behavior: 'instant' })}
                className="bg-blue-500 opacity-80 md:opacity-50 hover:opacity-80 border shadow rounded-full px-14 py-2 md:p-1 text-white fixed"
              >
                <ArrowUpIcon className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </div>
      {isMobile === false && (
        <div
          className="h-full sticky top-0 border-x hidden xl:block xl:w
-[calc((100vw-776px)/2)] 2xl:w-[calc((1536px-776px)/2)] 2xl:mr-[calc((100
vw-1536px)/2)] "
        >
          <div className="flex flex-col justify-between h-full w-full">
            <div>
              <div className="p-5 pb-10">
                <SearchBox />
              </div>
              {leftCol}
            </div>
            <div className="p-5 w-full text-right">
              <a
                href="https://docs.polycentric.io/privacy-policy/"
                target="_blank"
                rel="noreferrer"
                className="text-gray-400 text-sm"
              >
                Privacy Policy
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
