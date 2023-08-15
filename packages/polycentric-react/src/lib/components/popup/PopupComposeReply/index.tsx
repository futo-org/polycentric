import React, { useState, useRef, useEffect } from 'react'
import { Compose } from '../../feed/Compose'
import { Profile } from '../../../types/profile'
import { Modal } from '../../util/modal'

export const PopupComposeReply = ({
  main,
  sub,
}: {
  main: {
    content: string
    author: Profile
    publishedAt: Date
    topic: string
  }
  sub?: {
    content: string
    author: Profile
    publishedAt: Date
    topic: string
    ContentLink?: string
  }
}) => {
  return (
    <div className="px-3 py-5 md:px-7 bg-white overflow-clip flex flex-col space-y-0 w-auto md:w-[40rem]">
      <div className="flex relative overflow-clip">
        <div className="mr-3 md:mr-4 flex-shrink-0 flex flex-col overflow-clip">
          <img src={main.author.avatarURL} className="rounded-full h-16 w-16 md:h-20 md:w-20" />
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
              <div className='pb-3'>
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
      <div>
        <Compose hideTopic={false} maxTextboxHeightPx={250} topicDisabled={true} preSetTopic={main.topic} />
      </div>
    </div>
  )
}

export const PopupComposeReplyFullscreen = ({
  main,
  sub,
  open,
  setOpen,
}: {
  main: {
    content: string
    author: Profile
    publishedAt: Date
    topic: string
  }
  sub?: {
    content: string
    author: Profile
    publishedAt: Date
    topic: string
    ContentLink?: string
  }
  open: boolean
  setOpen: (b: boolean) => void
}) => {
  return (
    <Modal open={open} setOpen={setOpen}>
      <PopupComposeReply main={main} sub={sub} />
    </Modal>
  )
}
