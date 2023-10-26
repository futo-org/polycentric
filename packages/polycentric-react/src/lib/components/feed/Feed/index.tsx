import { encode } from '@borderless/base64'
import { Synchronization } from '@polycentric/polycentric-core'
import useVirtual, { Item, ScrollTo } from '@polycentric/react-cool-virtual'
import { useCallback, useState } from 'react'
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks'
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks'
import { useIsMobile } from '../../../hooks/styleHooks'
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

const ComposeIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-6 h-6"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
    />
  </svg>
)

// For when you're providing your own outerref so the scroll area can be wider than just the feed
export const InnerFeed = ({
  innerRef,
  items,
  scrollTo,
  hasScrolled,
  data,
  showComposeOnDesktop = false,
  mobileTopComponent,
}: {
  innerRef: React.MutableRefObject<HTMLDivElement | null>
  items: Item[]
  scrollTo: ScrollTo
  hasScrolled: boolean
  data: FeedHookData
  showComposeOnDesktop?: boolean
  mobileTopComponent?: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const showCompose = !isMobile && showComposeOnDesktop

  const { processHandle } = useProcessHandleManager()

  const [postingProgress, setPostingProgress] = useState(0)

  const onPost = useCallback(
    async (content: string, upload?: File): Promise<boolean> => {
      try {
        if (upload) {
          alert('uploading not yet supported, ask harpo to change ProcessHandle.post to support an image bundle')
        }
        setPostingProgress(0.1)
        await processHandle.post(content)
        setPostingProgress(0.5)
        await Synchronization.backFillServers(processHandle, processHandle.system())
        setPostingProgress(1)
        setTimeout(() => {
          setPostingProgress(0)
        }, 100)
      } catch (e) {
        console.error(e)
        setPostingProgress(0)
        return false
      }
      return true
    },
    [processHandle],
  )

  return (
    <div className="w-full lg:w-[700px] xl:w-[776px] relative  bg-white">
      {/* Attach the `innerRef` to the wrapper of the items */}
      {/* //@ts-ignore */}

      {postingProgress > 0 && (
        <div style={{ height: '4px', width: `${postingProgress * 100}%` }} className="bg-blue-500"></div>
      )}
      <div ref={innerRef} className="w-full lg:w-[700px] xl:w-[776px]" style={{ height: '100%' }}>
        {items.map(({ index, measureRef }) => (
          // You can set the item's height with the `size` property
          // TODO: change this to a proper index
          <Post ref={measureRef} key={encode(data[index]?.signedEvent.signature)} data={data[index]} />
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
    loadMore: () => advanceFeed(loadMoreCount),
  })

  const [hasScrolled, setHasScrolled] = useState(false)

  return (
    <div
      // @ts-ignore
      ref={outerRef} // Attach the `outerRef` to the scroll container
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
