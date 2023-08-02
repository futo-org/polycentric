import { Profile } from '../../../types/profile'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { LikeButton } from '../PurePost'
import { Link } from 'react-router-dom'

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

// eslint-disable-next-line react/display-name
export const PureRePost = forwardRef(
  (
    {
      main,
      sub,
    }: {
      main: {
        content: string
        author: Profile
        publishedAt: Date
        topic: string
      }
      sub: {
        subcontent: string
        subauthor: Profile
        subpublishedAt: Date
        subtopic: string
        subContentLink?: string
      }
    },
    ref,
  ) => {
    const mainRef = useRef<HTMLDivElement>(null)
    const subContentRef = useRef<HTMLDivElement>(null)
    const [contentCropped, setContentCropped] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [subcontentCropped, setSubcontentCropped] = useState(false)

    const { content, author, publishedAt, topic } = main
    const { subcontent, subauthor, subpublishedAt, subtopic, subContentLink } = sub

    useEffect(() => {
      if (mainRef.current != null && expanded === false) {
        setContentCropped(mainRef.current.clientHeight < mainRef.current.scrollHeight)
      }
    }, [content, expanded])

    useEffect(() => {
      if (subContentRef.current != null && subcontentCropped === false) {
        setSubcontentCropped(subContentRef.current.clientHeight < subContentRef.current.scrollHeight)
      }
    }, [subcontent, subcontentCropped])

    return (
      <Link to="#" className="cursor-default">
        <article className="px-3 py-5 md:px-10 md:py-10 border rounded-2xl bg-white overflow-clip" ref={ref}>
          <div className="flex relative overflow-clip">
            <div className="mr-3 md:mr-4 flex-shrink-0 flex flex-col overflow-clip">
              <img src={author.avatarURL} className="rounded-full h-16 w-16 md:h-20 md:w-20" />
              <div className="sticky top-full overflow-clip">
                <LikeButton
                  onClick={() => {
                    return
                  }}
                  count={69}
                  clicked={false}
                />
              </div>
            </div>
            <div className="flex-grow">
              <div className="flex w-full justify-between">
                <div className="font-bold text-md ">{author.name}</div>
                <div className="pr-3 md:pr-0 font-light text-gray-500">{dateToAgoString(publishedAt)}</div>
              </div>
              <div className=" text-purple-400 leading-3">{topic}</div>
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
                  {content}
                </main>
                {/* subpost */}
                <Link
                  to={subContentLink || '/'}
                  className="border rounded-2xl w-full p-5 bg-white overflow-clip flex flex-col space-y-3"
                >
                  <div className="flex">
                    <img src={subauthor.avatarURL} className="rounded-full h-5 w-5 md:h-10 md:w-10" />
                    <div className="flex flex-col ml-2 w-full">
                      <div className="flex justify-between w-full">
                        <div className="font-bold">{subauthor.name}</div>
                        <div className="pr-3 md:pr-0 font-light text-gray-500 text-sm">
                          {dateToAgoString(subpublishedAt)}
                        </div>
                      </div>
                      <div className=" text-purple-400 leading-3 text-sm">{subtopic}</div>
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
                    {subcontent}
                  </main>
                </Link>
              </div>
            </div>
          </div>
          {contentCropped && !expanded && (
            <div className="flex w-full justify-center mt-4">
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
