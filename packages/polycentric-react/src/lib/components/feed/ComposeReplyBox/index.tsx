import React, { useState, useRef, useEffect } from 'react'
import { PhotoIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { TopicSuggestionBox } from '../TopicSuggestionBox'
import { Compose } from '../Compose'

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

export const ComposeReplyBox = ({
  postTopic,
  postAuthor,
  postContent,
  postImage,
  postDate,
  postReplies,
  postLikes,
}: {
  postTopic: string
  postAuthor: string
  postContent: string
  postImage: string
  postDate: Date
  postReplies: string
  postLikes: string
}) => {
  const [content, setContent] = useState('')
  const [topic, setTopic] = useState('/')
  const [upload, setUpload] = useState<File | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  return (
    <div>
      <Compose hideTopic={true} />
    </div>
  )
}
