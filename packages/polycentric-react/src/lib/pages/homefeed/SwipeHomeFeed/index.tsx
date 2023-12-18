import { IonHeader, IonMenuToggle } from '@ionic/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Swiper as SwyperType } from 'swiper'
import 'swiper/css'
import './style.css'

import { Transition } from '@headlessui/react'
import { Controller } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Feed } from '../../../components'
import { useSearchFeed } from '../../../hooks/feedHooks'
import { ExploreFeed } from './ExploreFeed/index.js'
import { TopicFeed } from './TopicFeed.tsx/index.js'

const MenuIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-8 h-8"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5"
    />
  </svg>
)

const topics = ['Explore']

const ValidSearchFeed = ({ checkedQuery }: { checkedQuery: string }) => {
  const [data, advanceFeed] = useSearchFeed(checkedQuery)

  return <Feed data={data} advanceFeed={advanceFeed} />
}

const InvalidSearchFeed = () => {
  return <Feed data={[]} advanceFeed={() => {}} />
}

const SearchFeed = ({ query }: { query: string }) => {
  const validQuery = query && query.length >= 3

  return validQuery ? <ValidSearchFeed checkedQuery={query} /> : <InvalidSearchFeed />
}

const TopicSwipeSelect = ({
  topics,
  feedSwiper,
  setHeaderSwiper,
  handleSlideChange,
}: {
  topics: string[]
  feedSwiper: SwyperType | undefined
  setHeaderSwiper: (swiper: SwyperType) => void
  handleSlideChange: (swiper: SwyperType) => void
}) => {
  const expandPageRef = useRef<HTMLDivElement>(null)
  const [expandPageAbsolutePositon, setExpandPageAbsolutePosition] = useState({ x: 0, y: 0 })
  const [expanded, setExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchQuery, setActiveSearchQuery] = useState('')

  return (
    <div className="relative w-64 h-12">
      {/* Turn this into  */}
      <div
        className="absolute top-0 left-0 w-64 h-12 text-center border rounded-full z-30 overflow-clip"
        ref={expandPageRef}
        onClick={(e) => {
          if (expanded === false) {
            setExpandPageAbsolutePosition(e.currentTarget.getBoundingClientRect())
            setExpanded(true)
          }
        }}
      >
        {expanded ? (
          <input
            type="text"
            className="w-full h-full outline-none pl-6  text-2xl"
            autoFocus
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            value={searchQuery}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setActiveSearchQuery(searchQuery)
              }
            }}
            onBlur={() => {
              setActiveSearchQuery(searchQuery)
            }}
          />
        ) : (
          <Swiper
            modules={[Controller]}
            onSwiper={setHeaderSwiper}
            className="h-12 w-64"
            controller={{ control: feedSwiper }}
            allowSlidePrev={false}
            onSlideChange={handleSlideChange}
          >
            {topics.map((topic) => (
              <SwiperSlide key={topic}>
                <div className="flex h-full justify-center items-center">
                  <h1 className="text-2xl">{topic}</h1>
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
        )}
      </div>
      {/* pop up thing that expands to whole screen */}
      <Transition show={expanded}>
        <Transition.Child
          as="div"
          style={{
            top: `${expandPageAbsolutePositon.y}px`,
            left: `${expandPageAbsolutePositon.x}px`,
          }}
          enter="transition-all duration-200"
          enterFrom="h-12 w-64 rounded-[1.5rem] border-gray-200"
          enterTo="h-screen w-screen forcezerotopleft rounded-0 border-0 border-transparent"
          leave="transition-all duration-200"
          leaveFrom="h-screen w-screen forcezerotopleft rounded-[1.5rem] border-transparent"
          leaveTo="h-12 w-64 rounded-0 border-gray-200"
          className={'fixed z-20 bg-white overflow-clip ease-in-out'}
        >
          <div className="fixed top-0 left-0  w-screen h-screen"></div>
        </Transition.Child>
        <Transition.Child
          as="div"
          enter="transition-all ease-in duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-all ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          className="fixed top-0 left-0 z-30"
        >
          <div className="h-20 items-center fixed right-4 top-4">
            <button
              className="w-12 h-12 border rounded-full relative bg-white"
              onClick={() => {
                setSearchQuery('')
                setActiveSearchQuery('')
                setExpanded(false)
              }}
            >
              <div className="absolute w-[1px] h-8 left-1/2 top-2 bg-gray-400 transform rotate-45"></div>
              <div className="absolute w-[1px] h-8 left-1/2 top-2  bg-gray-400 transform -rotate-45"></div>
            </button>
          </div>
          <div className="fixed w-full top-20 h-full">
            <SearchFeed query={activeSearchQuery} />
          </div>
        </Transition.Child>
      </Transition>
    </div>
  )
}

export const SwipeHomeFeed = () => {
  const [headerSwiper, setHeaderSwiper] = useState<SwyperType>()
  const [feedSwiper, setFeedSwiper] = useState<SwyperType>()

  const handleSlideChange = useCallback((swiper: SwyperType) => {
    if (swiper.activeIndex === 0) {
      swiper.allowSlidePrev = false
    }
    if (swiper.activeIndex === topics.length - 1) {
      swiper.allowSlideNext = false
    }

    if (swiper.activeIndex !== 0 && swiper.activeIndex !== topics.length - 1) {
      swiper.allowSlidePrev = true
      swiper.allowSlideNext = true
    }
  }, [])

  useEffect(() => {
    if (headerSwiper) handleSlideChange(headerSwiper)
    if (feedSwiper) handleSlideChange(feedSwiper)
  }, [headerSwiper, feedSwiper, handleSlideChange])

  return (
    <>
      <IonHeader className="xl:hidden sticky top-0">
        <div className="flex items-center justify-between bg-white h-20 border-b">
          <IonMenuToggle>
            <div className="p-3">
              <MenuIcon />
            </div>
          </IonMenuToggle>
          <TopicSwipeSelect
            feedSwiper={feedSwiper}
            setHeaderSwiper={setHeaderSwiper}
            topics={topics}
            handleSlideChange={handleSlideChange}
          />
          <div className="p-3">
            <div className="w-8 h-8"></div>
          </div>
        </div>
      </IonHeader>

      <Swiper
        // h-full should work here but it doesn't
        className="w-full h-[calc(100dvh-5rem)]"
        modules={[Controller]}
        onSwiper={setFeedSwiper}
        controller={{ control: headerSwiper }}
        edgeSwipeDetection={true}
        edgeSwipeThreshold={50}
        onSlideChange={handleSlideChange}
      >
        {topics.map((topic) => (
          <SwiperSlide key={topic} style={{ overflow: 'auto' }}>
            {topic === 'Explore' ? <ExploreFeed /> : <TopicFeed topic={topic} />}
          </SwiperSlide>
        ))}
      </Swiper>
    </>
  )
}
