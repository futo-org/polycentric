import { IonContent, IonHeader, IonMenuToggle, isPlatform } from '@ionic/react';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { Swiper as SwyperType } from 'swiper';
import 'swiper/css';
import './style.css';

import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { Controller } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import { MobileSwipeTopicContext } from '../../../app/contexts';
import { PopupComposeFullscreen } from '../../../components';
import { ExploreFeed } from './ExploreFeed';
import { FollowingFeed } from './FollowingFeed';
import { TopicFeed } from './TopicFeed';

const MenuIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-8 h-8 text-black dark:text-white"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5"
    />
  </svg>
);



const TopicSwipeSelect = ({
  topics,
  feedSwiper,
  setHeaderSwiper,
  handleSlideChange,
}: {
  topics: string[];
  feedSwiper: SwyperType | undefined;
  setHeaderSwiper: (swiper: SwyperType) => void;
  handleSlideChange: (swiper: SwyperType) => void;
}) => {
  const [headerSwiper, setHeaderSwiperState] = useState<SwyperType | undefined>(
    undefined,
  );

  const handleHeaderSwiper = (swiper: SwyperType) => {
    setHeaderSwiperState(swiper);
    setHeaderSwiper(swiper);
  };

  return (
    <div className="flex-1 flex justify-center">
      <Swiper
        className="h-12 w-64"
        modules={[Controller]}
        onSwiper={handleHeaderSwiper}
        controller={{ control: feedSwiper }}
        edgeSwipeDetection={true}
        edgeSwipeThreshold={50}
        onSlideChange={handleSlideChange}
        cssMode={false}
      >
        {topics.map((topic) => (
          <SwiperSlide key={topic}>
            <div className="w-full h-full flex items-center justify-center">
              <h1 className="text-2xl text-black dark:text-white">{topic}</h1>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

export const SwipeHomeFeed = () => {
  const { topic: currentTopic, setTopic: setCurrentTopic } = useContext(
    MobileSwipeTopicContext,
  );
  const [headerSwiper, setHeaderSwiper] = useState<SwyperType | undefined>(
    undefined,
  );
  const [feedSwiper, setFeedSwiper] = useState<SwyperType | undefined>(
    undefined,
  );

  const swipeTopics = ['Explore', 'Following'];

  // Ensure we have a valid topic, default to 'Explore' if not set
  const validTopic = useMemo(() => {
    if (!currentTopic || !swipeTopics.includes(currentTopic)) {
      return 'Explore';
    }
    return currentTopic;
  }, [currentTopic, swipeTopics]);

  // Track if swipers are ready
  const [swipersReady, setSwipersReady] = useState(false);

  useEffect(() => {
    if (headerSwiper && feedSwiper) {
      setSwipersReady(true);
    }
  }, [headerSwiper, feedSwiper]);

  useEffect(() => {
    if (validTopic && swipersReady && headerSwiper && feedSwiper) {
      const index = swipeTopics.indexOf(validTopic);
      if (index !== -1 && index !== headerSwiper.activeIndex) {
        const currentIndex = headerSwiper.activeIndex;
        const indexDistance = Math.abs(index - currentIndex);
        const transitionDurationMS = indexDistance > 1 ? 1000 : 500;
        headerSwiper.slideTo(index, transitionDurationMS);
        feedSwiper.slideTo(index, transitionDurationMS);
      }
    }
  }, [validTopic, swipersReady, headerSwiper, feedSwiper, swipeTopics]);

  const handleSlideChange = useCallback(
    (swiper: SwyperType) => {
      if (!swiper || swiper.destroyed) return;

      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;

      if (swiper.activeIndex === 0) {
        swiper.allowSlidePrev = false;
      }
      if (swiper.activeIndex === swipeTopics.length - 1) {
        swiper.allowSlideNext = false;
      }

      // Update the context when the slide changes
      const newTopic = swipeTopics[swiper.activeIndex];
      if (newTopic && newTopic !== currentTopic) {
        setCurrentTopic(newTopic);
      }
    },
    [swipeTopics, currentTopic, setCurrentTopic],
  );

  useEffect(() => {
    if (headerSwiper) handleSlideChange(headerSwiper);
    if (feedSwiper) handleSlideChange(feedSwiper);
  }, [headerSwiper, feedSwiper, handleSlideChange]);

  // Initialize swipers to correct position when they become ready
  useEffect(() => {
    if (swipersReady && validTopic && headerSwiper && feedSwiper) {
      const index = swipeTopics.indexOf(validTopic);
      if (index !== -1) {
        // Use a small delay to ensure swipers are fully initialized
        const timer = setTimeout(() => {
          if (
            headerSwiper &&
            feedSwiper &&
            !headerSwiper.destroyed &&
            !feedSwiper.destroyed
          ) {
            headerSwiper.slideTo(index, 0);
            feedSwiper.slideTo(index, 0);
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [swipersReady, validTopic, headerSwiper, feedSwiper, swipeTopics]);

  const [composeModalOpen, setComposeModalOpen] = useState(false);

  const isMobileNonIOS = useMemo(() => {
    return isPlatform('mobile') && !isPlatform('ios') && !isPlatform('ipad');
  }, []);

  return (
    <>
      <IonHeader className="">
        <div className="flex items-center justify-between bg-white dark:bg-gray-900 h-20 border-b border-gray-200 dark:border-gray-700">
          <IonMenuToggle>
            <div className="p-3">
              <MenuIcon />
            </div>
          </IonMenuToggle>
          <TopicSwipeSelect
            feedSwiper={feedSwiper}
            setHeaderSwiper={setHeaderSwiper}
            topics={swipeTopics}
            handleSlideChange={handleSlideChange}
          />
          <div className="p-3">
            <div className="w-8 h-8"></div>
          </div>
        </div>
      </IonHeader>
      <IonContent className="h-[calc(100dvh-5rem)]">
        <Swiper
          // h-full should work here but it doesn't
          className="w-full h-full"
          modules={[Controller]}
          onSwiper={setFeedSwiper}
          controller={{ control: headerSwiper }}
          edgeSwipeDetection={true}
          edgeSwipeThreshold={50}
          onSlideChange={handleSlideChange}
          cssMode={isMobileNonIOS}
        >
          {swipeTopics.map((topic) => (
            <SwiperSlide key={topic} style={{ overflow: 'auto' }}>
              {topic === 'Explore' ? (
                <ExploreFeed />
              ) : topic === 'Following' ? (
                <FollowingFeed />
              ) : (
                <TopicFeed topic={topic} />
              )}
            </SwiperSlide>
          ))}
        </Swiper>
        <button
          onClick={() => setComposeModalOpen(true)}
          className="fixed bottom-4 right-4 w-16 h-16 bg-blue-500 rounded-full flex justify-center items-center z-10"
        >
          <PencilSquareIcon className="w-8 h-8 text-white" />
        </button>
        <PopupComposeFullscreen
          open={composeModalOpen}
          setOpen={setComposeModalOpen}
          preSetTopic={
            swipeTopics[feedSwiper?.activeIndex ?? 0] !== 'Explore' &&
            swipeTopics[feedSwiper?.activeIndex ?? 0] !== 'Following'
              ? swipeTopics[feedSwiper?.activeIndex ?? 0]
              : undefined
          }
        />
      </IonContent>
    </>
  );
};
