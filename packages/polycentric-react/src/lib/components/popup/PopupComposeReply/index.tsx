import { useCallback } from 'react'
import { useIsMobile } from '../../../hooks/styleHooks'
import { Compose } from '../../feed/Compose'
import { Modal } from '../../util/modal'

interface PopupComposeReplyProfile {
  name?: string
  avatarURL?: string
}

export const PopupComposeReply = ({
  main,
  sub,
  onComment,
}: {
  main: {
    content: string
    publishedAt?: Date
    author: PopupComposeReplyProfile
    topic: string
  }
  sub?: {
    content: string
    publishedAt?: Date
    author: PopupComposeReplyProfile
    topic: string
    ContentLink?: string
  }
  onComment: (content: string, upload?: File) => Promise<boolean>
}) => {
  const isMobile = useIsMobile()

  return (
    <div className="px-3 py-5 md:px-7 bg-white overflow-clip flex flex-col space-y-0 w-auto md:w-[40rem] h-full">
      <div className="flex relative overflow-clip">
        <div className="mr-3 md:mr-4 flex-shrink-0 flex flex-col overflow-clip">
          <div className="rounded-full h-16 w-16 md:h-20 md:w-20 overflow-clip border">
            <img src={main.author.avatarURL} />
          </div>
          <div className={`flex-grow flex justify-center items-center ${sub != null ? 'py-3' : 'py-2'}`}>
            <div className={`border h-full ${sub != null ? 'h-full' : 'min-h-[2rem]'}`}></div>
          </div>
        </div>
        <div className="flex-grow">
          <div className="flex w-full justify-between">
            <div className="font-bold text-md ">{main.author.name}</div>
            {/* <div className="pr-3 md:pr-0 font-light text-gray-500">{dateToAgoString(main.publishedAt)}</div> */}
          </div>
          <div className=" text-purple-400 leading-3">{main.topic}</div>
          <div className="flex flex-col space-y-3">
            {/* Actual post content */}
            <main
              className={
                'pt-4 leading-normal whitespace-pre-line text-lg text-gray-900 font-normal overflow-clip line-clamp-[7]'
              }
            >
              {main.content}
            </main>
            {/* sub.post */}
            {sub && (
              <div className="pb-3">
                <div className="border rounded-2xl w-full p-5 bg-white overflow-clip flex flex-col space-y-3">
                  <div className="flex">
                    <img src={sub.author.avatarURL} className="rounded-full h-5 w-5 md:h-10 md:w-10" />
                    <div className="flex flex-col ml-2 w-full">
                      <div className="flex justify-between w-full">
                        <div className="font-bold">{sub.author.name}</div>
                        <div className="pr-3 md:pr-0 font-light text-gray-500 text-sm">
                          {/* {dateToAgoString(sub.publishedAt)} */}
                        </div>
                      </div>
                      <div className=" text-purple-400 leading-3 text-sm">{sub.topic}</div>
                    </div>
                  </div>
                  <main className={`line-clamp-[4]`}>{sub.content}</main>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <Compose
        hideTopic={true}
        maxTextboxHeightPx={isMobile ? 0 : 250}
        topicDisabled={true}
        preSetTopic={main.topic}
        onPost={onComment}
        flexGrow={isMobile}
      />
    </div>
  )
}

export const PopupComposeReplyFullscreen = ({
  main,
  sub,
  open,
  setOpen,
  onComment,
}: {
  main: {
    content: string
    publishedAt?: Date
    author: PopupComposeReplyProfile
    topic: string
  }
  sub?: {
    content: string
    publishedAt?: Date
    author: PopupComposeReplyProfile
    topic: string
    ContentLink?: string
  }
  open: boolean
  setOpen: (b: boolean) => void
  onComment?: (content: string, upload?: File) => Promise<boolean>
}) => {
  const onCommentWithClose = useCallback(
    async (content: string, upload?: File) => {
      try {
        await onComment?.(content, upload)
        setOpen(false)
        return true
      } catch (e) {
        return false
      }
    },
    [onComment, setOpen],
  )
  return (
    <Modal open={open} setOpen={setOpen}>
      <PopupComposeReply main={main} sub={sub} onComment={onCommentWithClose} />
    </Modal>
  )
}
