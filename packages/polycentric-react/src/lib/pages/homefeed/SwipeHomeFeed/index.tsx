import { IonContent, IonHeader, IonMenuToggle, isPlatform } from '@ionic/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Swiper as SwyperType } from 'swiper';
import 'swiper/css';
import './style.css';

import { Transition } from '@headlessui/react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { Models, Util } from '@polycentric/polycentric-core';
import { Controller } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import { MobileSwipeTopicContext } from '../../../app/contexts';
import { Feed, PopupComposeFullscreen } from '../../../components';
import { Link } from '../../../components/util/link';
import { useSearchPostsFeed } from '../../../hooks/feedHooks';
import { useGestureWall } from '../../../hooks/ionicHooks';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import {
  useQueryCRDTSet,
  useQueryTopStringReferences,
} from '../../../hooks/queryHooks';
import {
  normalizeTopic as normalizeTopicString,
  useTopicDisplayText,
  useTopicLink,
} from '../../../hooks/utilHooks';
import { numberTo4Chars } from '../../../util/etc';
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

const PopupSearchMenuContext = createContext<{
  close: () => void;
}>({
  close: () => {},
});

const PostSearchResults = ({ query }: { query: string }) => {
  const [data, advanceFeed, nothingFound] = useSearchPostsFeed(query);

  return (
    <Feed data={data} advanceFeed={advanceFeed} nothingFound={nothingFound} />
  );
};

const searchTypeNames = ['topics', 'posts'];

const TopicSearchResultsItem = ({
  topic,
}: {
  topic: Models.AggregationBucket.Type;
}) => {
  const topicLink = useTopicLink(topic.key);
  const displayText = useTopicDisplayText(topic.key);
  const { close } = useContext(PopupSearchMenuContext);
  return (
    <Link
      className="flex space-x-3 items-center w-full p-1 rounded-[1.75rem] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 ease-in-out cursor-pointer"
      key={topic.key}
      routerLink={topicLink}
      routerDirection="forward"
      onClick={close}
    >
      <div className="bg-gray-100 dark:bg-gray-700 h-12 w-12 text-sm rounded-full flex justify-center items-center text-black dark:text-white">
        {numberTo4Chars(topic.value)}
      </div>
      <div className="text-lg text-black dark:text-white">{displayText}</div>
    </Link>
  );
};

const TopicSearchResults = ({ query }: { query?: string }) => {
  const hookOptions = useMemo(() => {
    return { query, minQueryChars: 3 };
  }, [query]);

  const topTopicsAll = useQueryTopStringReferences(hookOptions);

  // load blocked topics
  const { processHandle } = useProcessHandleManager();
  const system = useMemo(() => processHandle.system(), [processHandle]);

  const [blockedEvents, advanceBlocked] = useQueryCRDTSet(
    system,
    Models.ContentType.ContentTypeBlockTopic,
    100,
  );

  useEffect(() => {
    advanceBlocked();
  }, [advanceBlocked]);

  const blockedSet = useMemo(() => {
    const s = new Set<string>();
    blockedEvents.forEach((e) => {
      const v = e.lwwElementSet?.value;
      if (v) {
        const plain = Util.decodeText(v);
        s.add(normalizeTopicString(plain));
      }
    });
    return s;
  }, [blockedEvents]);

  const topTopics = useMemo(() => {
    return topTopicsAll.filter(
      (t) => !blockedSet.has(normalizeTopicString(t.key)),
    );
  }, [topTopicsAll, blockedSet]);

  return (
    <div className="flex flex-col space-y-2 w-[18rem] pt-4">
      {topTopics.map((topic) => (
        <TopicSearchResultsItem topic={topic} key={topic.key} />
      ))}
    </div>
  );
};

const SearchArea = ({
  realTimeQuery,
  enterPressedQuery,
}: {
  realTimeQuery: string;
  enterPressedQuery: string;
}) => {
  const [searchType, setSearchType] = useState<'topics' | 'posts'>('topics');

  return (
    <div className="flex flex-col items-center h-full">
      <div className="flex w-64 justify-around">
        {searchTypeNames.map((searchTypeName) => (
          <button
            key={searchTypeName}
            className={`font-medium text-md p-2 rounded-full text-black dark:text-white ${
              searchTypeName === searchType ? 'bg-gray-200 dark:bg-gray-600' : ''
            }`}
            onClick={() => setSearchType(searchTypeName as 'topics' | 'posts')}
          >
            {searchTypeName}
          </button>
        ))}
      </div>
      {/* post and account searches are much more expensive and don't have an expectation of autocomplete */}
      {searchType === 'topics' ? (
        <TopicSearchResults query={realTimeQuery} />
      ) : searchType === 'posts' ? (
        <PostSearchResults query={enterPressedQuery} />
      ) : undefined}
    </div>
  );
};

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
  const expandPageRef = useRef<HTMLDivElement>(null);
  const [expandPageAbsolutePositon, setExpandPageAbsolutePosition] = useState({
    x: 0,
    y: 0,
  });
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');

  const searchBoxRef = useRef<HTMLInputElement>(null);

  // useeffect to blur on document scroll
  useEffect(() => {
    const listener = () => searchBoxRef.current?.blur();
    document.addEventListener('scroll', listener);
    return () => {
      document.removeEventListener('scroll', listener);
    };
  }, [expanded]);

  const closeCallback = useCallback(() => {
    setSearchQuery('');
    setActiveSearchQuery('');
    setExpanded(false);
  }, []);

  useGestureWall(expanded);

  return (
    <PopupSearchMenuContext.Provider value={{ close: closeCallback }}>
      <div className="relative w-64 h-12">
        {/* Turn this into  */}
        <div
          className="absolute top-0 left-0 w-64 h-12 text-center border border-gray-200 dark:border-gray-600 rounded-full z-30 overflow-clip"
          ref={expandPageRef}
          onClick={(e) => {
            if (expanded === false) {
              setExpandPageAbsolutePosition(
                e.currentTarget.getBoundingClientRect(),
              );
              setExpanded(true);
            }
          }}
        >
          {expanded ? (
            <input
              type="text"
              className="w-full h-full outline-none pl-6 text-2xl text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              autoFocus
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              value={searchQuery}
              ref={searchBoxRef}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setActiveSearchQuery(searchQuery);
                }
              }}
              onBlur={() => {
                setActiveSearchQuery(searchQuery);
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
                    <h1 className="text-2xl text-black dark:text-white">{topic}</h1>
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
            leaveFrom="h-screen w-screen forcezerotopleft rounded-0 border-transparent"
            leaveTo="h-12 w-64 rounded-0 border-gray-200 rounded-[1.5rem]"
            className={'fixed z-20 bg-white dark:bg-gray-900 overflow-clip ease-in-out'}
          >
            {/* <div className="fixed top-0 left-0  w-screen h-screen"></div> */}
          </Transition.Child>
          <Transition.Child
            as="div"
            enter="transition-all ease-in duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-all ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            // no pointer events so we can click through to the search bar
            // we reenable pointer events on x button
            className="fixed top-0 left-0 w-full z-30 pointer-events-none"
          >
            <div className="h-20 w-[22.2rem] m-auto flex items-center justify-end">
              <button
                className="w-12 h-12 border border-gray-300 dark:border-gray-600 rounded-full relative bg-white dark:bg-gray-800 pointer-events-auto"
                onClick={closeCallback}
              >
                <div className="absolute w-[1px] h-8 left-1/2 top-2 bg-gray-400 dark:bg-gray-300 transform rotate-45"></div>
                <div className="absolute w-[1px] h-8 left-1/2 top-2 bg-gray-400 dark:bg-gray-300 transform -rotate-45"></div>
              </button>
            </div>
            <div className="fixed w-full top-[4.5rem] h-[100dvh] bg-white dark:bg-gray-900 overflow-y-auto pointer-events-auto">
              <SearchArea
                realTimeQuery={searchQuery}
                enterPressedQuery={activeSearchQuery}
              />
            </div>
          </Transition.Child>
        </Transition>
      </div>
    </PopupSearchMenuContext.Provider>
  );
};

export const SwipeHomeFeed = () => {
  const { topic: currentTopic, setTopic: setCurrentTopic } = useContext(MobileSwipeTopicContext);
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
          if (headerSwiper && feedSwiper && !headerSwiper.destroyed && !feedSwiper.destroyed) {
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
