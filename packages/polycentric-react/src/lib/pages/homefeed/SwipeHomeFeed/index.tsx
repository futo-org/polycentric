import { IonHeader, IonMenuToggle } from '@ionic/react'
import { useCallback, useEffect, useState } from 'react'
import { Swiper as SwyperType } from 'swiper'
import 'swiper/css'

import { Controller } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
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

const InfoIcon = () => (
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
      d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
    />
  </svg>
)

const topics = ['Explore', '/tpot', '/tpot/dating', '/tpot/technology.repair', '/tpot/technology']

export const SwipeHomeFeed = () => {
  const [headerSwiper, setHeaderSwiper] = useState<SwyperType>()
  const [feedSwiper, setFeedSwiper] = useState<SwyperType>()

  const handleSlideChange = useCallback(
    (swiper: SwyperType) => {
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
    },
    [topics],
  )

  useEffect(() => {
    if (headerSwiper) handleSlideChange(headerSwiper)
    if (feedSwiper) handleSlideChange(feedSwiper)
  }, [headerSwiper, feedSwiper, handleSlideChange])

  return (
    <>
      <IonHeader className="xl:hidden">
        <div className="flex items-center justify-center bg-white h-20 border-b">
          <IonMenuToggle>
            <div className="p-3">
              <MenuIcon />
            </div>
          </IonMenuToggle>
          <Swiper
            modules={[Controller]}
            onSwiper={setHeaderSwiper}
            controller={{ control: feedSwiper }}
            className="w-64 h-12 text-center border rounded-full"
            allowSlidePrev={false}
            onSlideChange={handleSlideChange}
          >
            {topics.map((topic, i) => (
              <SwiperSlide key={topic}>
                <div className="flex h-full justify-center items-center">
                  <h1 className="text-2xl">{topic}</h1>
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
          <div className="p-3">
            <InfoIcon />
          </div>
        </div>
      </IonHeader>

      <Swiper
        className="w-full h-full"
        modules={[Controller]}
        onSwiper={setFeedSwiper}
        controller={{ control: headerSwiper }}
        edgeSwipeDetection={true}
        edgeSwipeThreshold={50}
        onSlideChange={handleSlideChange}
      >
        {topics.map((topic, i) => (
          <SwiperSlide key={topic} style={{ overflow: 'auto' }}>
            {topic === 'Explore' ? <ExploreFeed /> : <TopicFeed topic={topic} />}
          </SwiperSlide>
        ))}
      </Swiper>
    </>
  )
}
