import React, { useState, useRef, useEffect } from 'react'
import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { TopicSuggestionBox } from '../TopicSuggestionBox'

const startsWithSlash = /^\/.*/

const testTopics = {
  polycentric: {
    updates: {
      images: {},
    },
  },
  popcornLovers: {
    butter: {},
  },
  tpot: {
    dating: {},
  },
  pakistan: {},
}

const TopicBox = ({ topic, setTopic }: { topic: string; setTopic: (s: string) => void }) => {
  const [focused, setFocused] = useState(false)
  return (
    <div className=" w-96  max-w-full h-[3rem] relative ml-1">
      <input
        type="text"
        name="postTopic"
        autoComplete="off"
        list="autocompleteOff"
        aria-autocomplete="none"
        className="bg-transparent w-full h-full p-5 absolute text-xl focus:outline-none peer z-10 font-mono"
        value={topic}
        onChange={(e) => {
          const { value } = e.target
          if (startsWithSlash.test(value)) {
            setTopic(value)
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div
        className={`absolute top-0 left-0 w-full h-full border-2 bg-white peer-focus:border-3 peer-focus:border-purple-900 rounded-lg -skew-x-[9deg]`}
      ></div>
      {focused && (
        <div className="absolute top-[3rem] w-full">
          <TopicSuggestionBox
            topics={testTopics}
            query={topic}
            setSelected={(s) => {
              setTopic(s)
              setFocused(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

export const Compose = ({ hideTopic }: { hideTopic?: boolean }) => {
  const [content, setContent] = useState('')
  const [topic, setTopic] = useState('/')
  const [upload, setUpload] = useState<File | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="flex flex-col">
      <div className="">
        {hideTopic ? null : <TopicBox topic={topic} setTopic={setTopic} />}
        <div className="flex flex-col mt-1.5 w-full border rounded-lg focus-within:outline ">
          <textarea
            className="w-full resize-none text-2xl rounded-lg p-4 focus:outline-none"
            value={content}
            onChange={(e) => {
              e.target.style.height = '0'
              let height = Math.max(100, e.target.scrollHeight)
              height = Math.min(height, 440)
              e.target.style.height = `${height}px`
              setContent(e.target.value)
            }}
            placeholder="What's hapenneing?!?!?!?!"
          />
          {upload && (
            <div>
              <div className="p-4 inline-block relative">
                <img
                  className="max-h-[20rem] max-w-[20rem] rounded-sm inline-block border-gray-1000 border"
                  src={URL.createObjectURL(upload)}
                />
                <button className="absolute top-5 right-5 " onClick={() => setUpload(null)}>
                  <XCircleIcon className="w-9 h-9 text-gray-300 hover:text-gray-400" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-full flex justify-between pt-4">
          <div className="flex items-start space-x-4">
            <button onClick={() => uploadRef.current?.click()}>
              <PhotoIcon className="w-9 h-9 text-gray-300 hover:text-gray-400" />
            </button>
            <input
              type="file"
              className="hidden"
              name="img"
              accept="image/*"
              ref={uploadRef}
              onChange={(e) => {
                const { files } = e.target
                if (files !== null && files.length > 0) {
                  setUpload(files[0])
                }
              }}
            />
          </div>
          <button className="bg-blue-500 hover:bg-blue-600 text-white rounded-full px-8 py-2 font-extrabold text-lg">
            Post
          </button>
        </div>
      </div>
    </div>
  )
}
