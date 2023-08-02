import { Link } from 'react-router-dom'
import { Profile } from '../../../types/profile'
import { forwardRef, useEffect, useRef, useState } from 'react'

const dateToAgoString = (date: Date) => {
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
  clicked = false,
}: {
  name: string
  DefaultIcon: React.FC<{ color?: string }>
  ClickedIcon?: React.FC<{ color?: string }>
  iconColor?: string
  clickedIconColor?: string
  onClick: () => void
  count?: number
  clicked?: boolean
}) => {
  const Icon = (clicked ? ClickedIcon : DefaultIcon) ?? DefaultIcon
  const color = (clicked ? clickedIconColor : iconColor) ?? 'text-black'
  return (
    <button onClick={onClick} className="flex items-center space-x-1">
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

export const LikeButton = ({
  onClick,
  count,
  clicked = false,
}: {
  onClick: () => void
  count?: number
  clicked: boolean
}) => {
  return (
    <PostActionButton
      name="Like"
      DefaultIcon={HeartIconOutline}
      ClickedIcon={HeartIconSolid}
      clickedIconColor="text-red-500"
      onClick={onClick}
      count={count}
      clicked={clicked}
    />
  )
}

export const CommentButton = ({ onClick, count }: { onClick: () => void; count?: number }) => {
  return <PostActionButton name="Comment" DefaultIcon={CommentIconOutline} onClick={onClick} count={count} />
}

// eslint-disable-next-line react/display-name
export const PurePost = forwardRef(
  (
    {
      content,
      author,
      publishedAt,
      topic,
    }: {
      content: string
      author: Profile
      publishedAt: Date
      topic: string
    },
    ref,
  ) => {
    const mainRef = useRef<HTMLDivElement>(null)
    const [showMore, setShowMore] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [liked, setLiked] = useState(false)

    useEffect(() => {
      if (mainRef.current != null && expanded === false) {
        setShowMore(mainRef.current.clientHeight < mainRef.current.scrollHeight)
      }
    }, [content, expanded])

    return (
      <Link to="#" className="cursor-default">
        <article className="px-3 py-5 md:px-10 md:py-10 border rounded-2xl bg-white overflow-clip" ref={ref}>
          <div className="flex relative overflow-clip">
            <div className="mr-3 md:mr-4 flex-shrink-0 flex flex-col overflow-clip">
              <img src={author.avatarURL} className="rounded-full h-16 w-16 md:h-20 md:w-20" />
              <div className="sticky top-full pt-3 overflow-clip flex flex-col space-y-2">
                <LikeButton
                  onClick={() => {
                    setLiked(!liked)
                  }}
                  count={69}
                  clicked={liked}
                />
                <CommentButton onClick={() => ({})} count={420} />
              </div>
            </div>
            <div className="flex-grow">
              <div className="flex w-full justify-between">
                <Link to="#" className="font-bold text-md ">
                  {author.name}
                </Link>
                <div className="pr-3 md:pr-0 font-light text-gray-500">{dateToAgoString(publishedAt)}</div>
              </div>
              <Link to="#" className=" text-purple-400 leading-3">
                {topic}
              </Link>
              <main
                className={
                  'pt-4 leading-normal whitespace-pre-line text-lg text-gray-900 font-normal overflow-clip' +
                  (expanded ? '' : ' line-clamp-[7]') +
                  (showMore && !expanded
                    ? ` line-clamp-[7] relative
                    after:top-0 after:left-0  after:w-full after:h-full 
                    after:bg-gradient-to-b after:from-80% after:from-transparent after:to-white
                    after:absolute 
                    `
                    : '')
                }
                ref={mainRef}
              >
                {content}
              </main>
            </div>
          </div>
          {showMore && !expanded && (
            <div className="flex w-full justify-center -mt-5">
              <button onClick={() => setExpanded(true)} className="bg-gray-200 rounded-full font-bold px-10 z-10 py-3">
                Read more
              </button>
            </div>
          )}
        </article>
      </Link>
    )
  },
)
