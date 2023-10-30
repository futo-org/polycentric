import { forwardRef, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../../../hooks/styleHooks'
import { Profile } from '../../../../types/profile'
import { PopupComposeReplyFullscreen } from '../../../popup/PopupComposeReply'
import { Modal } from '../../../util/modal'

const dateToAgoString = (date: Date | undefined) => {
  if (date == null) {
    return ''
  }

  const diff = Date.now() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 24) {
    return date.toLocaleDateString()
  } else if (hours > 1) {
    return `${hours} h ago`
  } else if (minutes > 1) {
    return `${minutes} m ago`
  } else {
    return `${seconds} s ago`
  }
}

export const PostActionButton = ({
  name,
  DefaultIcon,
  ClickedIcon,
  iconColor,
  clickedIconColor,
  onClick,
  count,
  className,
  clicked = false,
}: {
  name: string
  DefaultIcon: React.FC<{ color?: string }>
  ClickedIcon?: React.FC<{ color?: string }>
  iconColor?: string
  clickedIconColor?: string
  onClick: () => void
  className?: string
  count?: number
  clicked?: boolean
}) => {
  const Icon = (clicked ? ClickedIcon : DefaultIcon) ?? DefaultIcon
  const color = (clicked ? clickedIconColor : iconColor) ?? 'text-black'
  return (
    <button onClick={onClick} className={'flex items-center space-x-1 ' + className}>
      <div className="" aria-label={name}>
        <Icon color={color} />
      </div>
      {count != null && <span className="text-gray-500 text-sm">{count}</span>}
    </button>
  )
}

const HeartIconOutline = ({ color }: { color?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className={`w-6 h-6 ${color}`}
    fill="none"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
    />
  </svg>
)

const HeartIconSolid = ({ color }: { color?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={`w-6 h-6 ${color}`}>
    <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
  </svg>
)

const RePostIconSolid = () => (
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
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
    />
  </svg>
)

const CommentIconOutline = ({ color }: { color?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={`w-6 h-6 ${color}`}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
    />
  </svg>
)

const ShareButton = () => (
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
      d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15"
    />
  </svg>
)

const BookmarkIcon = () => (
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
      d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
    />
  </svg>
)

export const LikeButton = ({
  onClick,
  count,
  className,
  clicked = false,
}: {
  onClick: () => void
  count?: number
  className?: string
  clicked: boolean
}) => {
  return (
    <PostActionButton
      name="Like"
      className={className}
      DefaultIcon={HeartIconOutline}
      ClickedIcon={HeartIconSolid}
      clickedIconColor="text-rose-700"
      onClick={onClick}
      count={count}
      clicked={clicked}
    />
  )
}

export const RePostButton = ({ onClick, count }: { onClick: () => void; count?: number }) => {
  return <PostActionButton name="RePost" DefaultIcon={RePostIconSolid} onClick={onClick} count={count} />
}

export const CommentButton = ({ onClick, count }: { onClick: () => void; count?: number }) => {
  return <PostActionButton name="Comment" DefaultIcon={CommentIconOutline} onClick={onClick} count={count} />
}

export const SharePostButton = ({ onClick }: { onClick: () => void }) => {
  return <PostActionButton name="Share" DefaultIcon={ShareButton} onClick={onClick} />
}

export const BookmarkPostButton = ({ onClick }: { onClick: () => void }) => {
  return <PostActionButton name="Bookmark" DefaultIcon={BookmarkIcon} onClick={onClick} />
}

export interface PurePostProps {
  main?: {
    content: string
    author: Profile
    publishedAt?: Date
    topic: string
    image?: string
  }
  sub?: {
    content: string
    author: Profile
    publishedAt?: Date
    topic: string
    image?: string
    ContentLink?: string
  }
  stats?: {
    likes: number
    reposts?: number
    comments: number
  }
  actions?: {
    like?: () => void
    unlike?: () => void
    liked?: boolean
    repost: () => void
    comment: (content: string, upload?: File) => Promise<boolean>
  }
}

// eslint-disable-next-line react/display-name
export const PurePost = forwardRef<HTMLDivElement, PurePostProps>(
  ({ main, sub, stats, actions }: PurePostProps, infiniteScrollRef) => {
    const mainRef = useRef<HTMLDivElement>(null)
    const subContentRef = useRef<HTMLDivElement>(null)
    const [contentCropped, setContentCropped] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [subcontentCropped, setsubcontentCropped] = useState(false)
    const [commentPanelOpen, setCommentPanelOpen] = useState(false)
    const [mainImageOpen, setMainImageOpen] = useState(false)

    const isMobile = useIsMobile()

    useEffect(() => {
      if (mainRef.current != null && expanded === false) {
        setContentCropped(mainRef.current.clientHeight < mainRef.current.scrollHeight)
      }
    }, [main, expanded])

    useEffect(() => {
      if (subContentRef.current != null && subcontentCropped === false) {
        setsubcontentCropped(subContentRef.current.clientHeight < subContentRef.current.scrollHeight)
      }
    }, [sub, subcontentCropped])

    return (
      <div ref={infiniteScrollRef}>
        {main == null ? (
          <div className="p-14 border-b border-gray-100 bg-white">
            <div className="w-full animate-pulse border border-blue-100 rounded-2xl h-5"></div>
          </div>
        ) : (
          <article className="px-3 pt-5 pb-3 lg:px-10 lg:pt-10 lg:pb-8 border-b border-gray-100 bg-white overflow-clip inline-block w-full">
            <div className="grid grid-cols-[fit-content(100%)_1fr] relative overflow-clip">
              {/* Left column */}
              <div className="mr-3 lg:mr-4 flex-shrink-0 flex flex-col overflow-clip">
                <div className="rounded-full h-10 w-10 md:h-16 md:w-16 lg:h-20 lg:w-20 overflow-clip border">
                  <img src={main.author.avatarURL} />
                </div>
                {(!isMobile || (isMobile && expanded)) && (
                  <div
                    className={`flex-col space-y-5 md:space-y-2 ${expanded ? 'sticky top-[50vh]' : ''} overflow-clip ${
                      // sub == null ? 'pt-5' : ''
                      'pt-5'
                    }`}
                  >
                    {isMobile === false && (
                      <>
                        <RePostButton
                          onClick={() => {
                            return
                          }}
                          count={isMobile ? undefined : stats?.reposts}
                        />
                        <CommentButton
                          onClick={() => {
                            setCommentPanelOpen(true)
                          }}
                          count={isMobile ? undefined : stats?.comments}
                        />
                      </>
                    )}
                    <LikeButton
                      className="justify-center w-full md:justify-normal md:w-auto"
                      onClick={() => (actions?.liked ? actions?.unlike?.() : actions?.like?.())}
                      count={isMobile ? undefined : stats?.likes}
                      clicked={actions?.liked ?? false}
                    />
                  </div>
                )}
              </div>
              {/* Right column */}
              <div className="flex-grow w-full lg:max-w-[600px]">
                <div className="flex w-full justify-between">
                  <div className="">
                    <address className="font-bold text-md author not-italic">{main.author.name}</address>
                    <div className="text-purple-400 leading-3">{main.topic}</div>
                  </div>
                  <div className="flex space-x-2 text-gray-700 items-center">
                    <time className="text-right sm:text-right pr-3 lg:pr-0 font-light text-gray-500 tracking-tight">
                      {dateToAgoString(main.publishedAt)}
                    </time>
                    <div className="flex flex-col-reverse sm:flex-row">
                      <BookmarkPostButton onClick={() => []} />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col space-y-3">
                  {/* Actual post content */}
                  <main
                    className={
                      'pt-4 leading-normal whitespace-pre-line text-lg text-gray-900 font-normal overflow-clip' +
                      (expanded ? '' : ' line-clamp-[7]') +
                      (contentCropped && !expanded
                        ? ` line-clamp-[7] relative
                  after:top-0 after:left-0  after:w-full after:h-full 
                  after:bg-gradient-to-b after:from-80% after:from-transparent after:to-white
                  after:absolute `
                        : '')
                    }
                    ref={mainRef}
                  >
                    {main.content}
                  </main>
                  <button onClick={() => setMainImageOpen(true)}>
                    <img src={main.image} className="rounded-2xl max-h-60 max-w-full w-fit hover:opacity-80" />
                  </button>
                  {/* sub.post */}
                  {sub && (
                    <div className="border rounded-2xl w-full p-5 bg-white hover:bg-gray-50 overflow-clip flex flex-col space-y-3">
                      <div className="flex">
                        <img src={sub.author.avatarURL} className="rounded-full h-5 w-5 lg:h-10 lg:w-10" />
                        <div className="flex flex-col ml-2 w-full">
                          <div className="flex justify-between w-full">
                            <div className="font-bold">{sub.author.name}</div>
                            <div className="pr-3 lg:pr-0 font-light text-gray-500 text-sm">
                              {dateToAgoString(sub.publishedAt)}
                            </div>
                          </div>
                          <div className=" text-purple-400 leading-3 text-sm">{sub.topic}</div>
                        </div>
                      </div>
                      <main
                        ref={subContentRef}
                        className={`line-clamp-[4]  ${
                          subcontentCropped
                            ? `relative after:top-0 after:left-0  after:w-full after:h-full 
                        after:bg-gradient-to-b after:from-20% after:from-transparent after:to-white
                        after:absolute`
                            : ''
                        }`}
                      >
                        {sub.content}
                      </main>
                    </div>
                  )}
                </div>
              </div>
              {contentCropped && !expanded && (
                // Bot columns so it's centered
                <div className="col-span-2 flex w-full justify-center mt-4">
                  <button
                    onClick={() => {
                      setExpanded(true)
                    }}
                    className="bg-gray-200 rounded-full font-bold px-10 z-10 py-3"
                  >
                    Read more
                  </button>
                </div>
              )}
              {/* Left column */}
              <div className="col-start-2 lg:hidden flex justify-between pt-6">
                <RePostButton
                  onClick={() => {
                    return
                  }}
                  count={stats?.reposts}
                />
                <CommentButton
                  onClick={() => {
                    setCommentPanelOpen(true)
                  }}
                  count={stats?.comments}
                />
                <LikeButton
                  onClick={() => (actions?.liked ? actions?.unlike?.() : actions?.like?.())}
                  count={stats?.likes}
                  clicked={actions?.liked ?? false}
                />
                <SharePostButton
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: 'Polycentric',
                        text: main.content,
                        url: window.location.href,
                      })
                    }
                  }}
                />
              </div>
            </div>
            <PopupComposeReplyFullscreen
              open={commentPanelOpen}
              main={main}
              sub={sub}
              setOpen={(open) => setCommentPanelOpen(open)}
              onComment={actions?.comment}
            />
            <Modal open={mainImageOpen} setOpen={(open) => setMainImageOpen(open)}>
              <div className="m-5">
                <img className="rounded-2xl w-[90%] max-w-[30rem]" src={main.image} />
              </div>
            </Modal>
          </article>
        )}
      </div>
    )
  },
)
