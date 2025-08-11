import { IonHeader, IonMenuToggle } from '@ionic/react';
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
import { Feed } from '../../../components';
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
import { ForumServerListPage } from '../../forums/ForumServerListPage';
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
    className="w-8 h-8 text-black"
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
      className="flex space-x-3 items-center w-full p-1 rounded-[1.75rem] hover:bg-gray-100 transition-colors duration-200 ease-in-out cursor-pointer"
      key={topic.key}
      routerLink={topicLink}
      routerDirection="forward"
      onClick={close}
    >
      <div className="bg-gray-100 h-12 w-12 text-sm rounded-full flex justify-center items-center">
        {numberTo4Chars(topic.value)}
      </div>
      <div className="text-lg">{displayText}</div>
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
  const system = useMemo(
    () => (processHandle ? processHandle.system() : undefined),
    [processHandle],
  );

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
            className={`font-medium text-md p-2 rounded-full ${
              searchTypeName === searchType ? 'bg-gray-200' : ''
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
          className="absolute top-0 left-0 w-64 h-12 text-center border rounded-full z-30 overflow-clip"
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
              className="w-full h-full outline-none pl-6  text-2xl"
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
                    <h1 className="text-2xl text-black">{topic}</h1>
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
            className={'fixed z-20 bg-white overflow-clip ease-in-out'}
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
                className="w-12 h-12 border rounded-full relative bg-white pointer-events-auto"
                onClick={closeCallback}
              >
                <div className="absolute w-[1px] h-8 left-1/2 top-2 bg-gray-400 transform rotate-45"></div>
                <div className="absolute w-[1px] h-8 left-1/2 top-2  bg-gray-400 transform -rotate-45"></div>
              </button>
            </div>
            <div className="fixed w-full top-[4.5rem] h-[100dvh] bg-white overflow-y-auto pointer-events-auto">
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
  const { processHandle } = useProcessHandleManager();
  const system = processHandle ? processHandle.system() : undefined;
  const [followingEvents, advanceFollowing] = useQueryCRDTSet(
    system,
    Models.ContentType.ContentTypeFollow,
    50,
  );
  const [headerSwiper, setHeaderSwiper] = useState<SwyperType>();
  const [feedSwiper, setFeedSwiper] = useState<SwyperType>();
  const { topic: currentMobileTopic, setTopic: setCurrentMobileTopic } =
    useContext(MobileSwipeTopicContext);

  useEffect(() => {
    advanceFollowing();
  }, [advanceFollowing]);

  const followingTopics = useMemo(() => {
    return Util.filterUndefined(
      followingEvents.map((event) => event.lwwElementSet?.value),
    ).map((value) => Util.decodeText(value));
  }, [followingEvents]);

  const topics = useMemo(() => {
    return ['Following', 'Explore', ...followingTopics];
  }, [followingTopics]);

  const handleSlideChange = useCallback(
    (swiper: SwyperType) => {
      setCurrentMobileTopic(topics[swiper.activeIndex]);
    },
    [setCurrentMobileTopic, topics],
  );

  useEffect(() => {
    const topicIndex = topics.indexOf(currentMobileTopic);
    if (topicIndex !== -1 && feedSwiper && !feedSwiper.destroyed) {
      feedSwiper.slideTo(topicIndex);
    }
  }, [currentMobileTopic, feedSwiper, topics]);

  const MainContent = useMemo(() => {
    if (currentMobileTopic === 'Forums') {
      return <ForumServerListPage />;
    }
    return (
      <Swiper
        modules={[Controller]}
        onSwiper={setFeedSwiper}
        controller={{ control: headerSwiper }}
        onSlideChange={handleSlideChange}
        className="h-full"
      >
        <SwiperSlide>
          <FollowingFeed />
        </SwiperSlide>
        <SwiperSlide>
          <ExploreFeed />
        </SwiperSlide>
        {followingTopics.map((topic) => (
          <SwiperSlide key={topic}>
            <TopicFeed topic={topic} />
          </SwiperSlide>
        ))}
      </Swiper>
    );
  }, [currentMobileTopic, headerSwiper, followingTopics, handleSlideChange]);

  return (
    <>
      <IonHeader className="flex justify-center p-2 items-center">
        <IonMenuToggle>
          <MenuIcon />
        </IonMenuToggle>
        <div className="flex-grow">
          <TopicSwipeSelect
            topics={topics}
            feedSwiper={feedSwiper}
            setHeaderSwiper={setHeaderSwiper}
            handleSlideChange={handleSlideChange}
          />
        </div>
        <Link routerLink="/compose">
          <PencilSquareIcon className="w-8 h-8 text-black" />
        </Link>
      </IonHeader>
      {MainContent}
    </>
  );
};
