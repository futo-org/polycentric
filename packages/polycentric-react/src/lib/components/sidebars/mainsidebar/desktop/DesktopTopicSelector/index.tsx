import {
  ArrowTrendingUpIcon,
  StarIcon as StarIconOutlined,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { Models, Util } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProcessHandleManager } from '../../../../../hooks/processHandleManagerHooks';
import {
  QueryTopStringReferencesOptions,
  useQueryCRDTSet,
  useQueryTopStringReferences,
} from '../../../../../hooks/queryHooks';
import {
  useTopicDisplayText,
  useTopicLink,
} from '../../../../../hooks/utilHooks';
import { numberTo4Chars } from '../../../../../util/etc';
import { Link } from '../../../../util/link';
import { DesktopTopicSearch } from '../DesktopTopicSearch';

const TopicListItem = ({
  topic,
  mode,
}: {
  topic: Models.AggregationBucket.Type;
  mode: 'trend' | 'history';
}) => {
  const valueString = useMemo(() => {
    if (mode === 'trend') {
      return numberTo4Chars(topic.value);
    } else {
      return undefined;
    }
  }, [topic.value, mode]);

  const { processHandle } = useProcessHandleManager();
  const system = useMemo(() => processHandle.system(), [processHandle]);

  const [mainHovered, setMainHovered] = useState(false);
  const [buttonHovered, setButtonHovered] = useState(false);

  const [topicJoined, setTopicJoined] = useState(false);

  const refreshIfAdded = useCallback(() => {
    processHandle
      .store()
      .indexCRDTElementSet.queryIfAdded(
        system,
        Models.ContentType.ContentTypeJoinTopic,
        Util.encodeText(topic.key),
      )
      .then((result) => {
        setTopicJoined(result);
      });
  }, [processHandle, system, topic]);

  useEffect(() => {
    refreshIfAdded();
  }, [refreshIfAdded]);

  const topicLink = useTopicLink(topic.key);
  const topicString = useTopicDisplayText(topic.key);

  const styleMainAsHovered = mainHovered && !buttonHovered;

  return (
    <Link
      className={`py-0.5 px-1 rounded flex items-center space-x-2 text-left 
            transition-colors duration-200 cursor-pointer ${
              styleMainAsHovered ? 'hover:bg-gray-100' : ''
            }`}
      activeClassName={'bg-gray-100 text-gray-800'}
      key={topic.key}
      routerLink={topicLink}
      routerDirection="root"
      onMouseEnter={() => setMainHovered(true)}
      onMouseLeave={() => setMainHovered(false)}
    >
      <button
        className="h-10 w-10"
        onClick={(e) => {
          // prevent the link from being clicked
          e.preventDefault();
          e.stopPropagation();
          if (topicJoined) {
            processHandle
              .leaveTopic(topic.key)
              .then(() => void refreshIfAdded());
          } else {
            // Ensure topic not blocked before joining
            processHandle.unblockTopic?.(topic.key).finally(() => {
              processHandle
                .joinTopic(topic.key)
                .then(() => void refreshIfAdded());
            });
          }
        }}
        onMouseEnter={() => setButtonHovered(true)}
        onMouseLeave={() => setButtonHovered(false)}
      >
        {mode === 'trend' && !buttonHovered ? (
          <div
            className={`h-9 aspect-square text-xs text-gray-900 rounded-full flex 
                                    justify-center items-center border-2 bg-gray-50
                                    ${
                                      topicJoined
                                        ? 'border-blue-100'
                                        : 'border-gray-50'
                                    }`}
          >
            {valueString}
          </div>
        ) : (
          <div
            className={`h-9 aspect-square rounded-full 
                                    flex justify-center items-center transition-[border-radius]
                                     ${
                                       topicJoined
                                         ? 'bg-gray-50'
                                         : 'hover:bg-gray-50 hover:bg-opacity-50'
                                     }
                                     ${
                                       topicJoined && mode === 'trend'
                                         ? 'border-2 border-blue-100'
                                         : 'border-0'
                                     }
                                     `}
          >
            {buttonHovered ? (
              <StarIconOutlined className={`h-4 w-4 text-gray-700`} />
            ) : (
              <StarIconSolid className={`h-4 w-4 text-gray-300`} />
            )}
          </div>
        )}
      </button>
      <div className="flex-grow pl-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {topicString}
      </div>
      {/* Add another w-9 empty thing here so the text doesn't stretch to the end */}
      <div className="w-9 flex-shrink-0" />
    </Link>
  );
};

const TrendingTopics = () => {
  const hookOptions: QueryTopStringReferencesOptions = useMemo(() => {
    return {
      query: undefined,
      limit: 30,
      timeRange: '7d',
    };
  }, []);

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

  const blockedTopicSet = useMemo(() => {
    const set = new Set<string>();
    blockedEvents.forEach((e) => {
      const value = e.lwwElementSet?.value;
      if (value) {
        const plain = Util.decodeText(value);
        set.add(plain);
        set.add(window.btoa(String.fromCharCode(...value)));
      }
    });
    return set;
  }, [blockedEvents]);

  const trendingTopicsAll = useQueryTopStringReferences(hookOptions);

  const decodeBase64Topic = (t: string): string => {
    const looksLikeBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(t);
    if (!looksLikeBase64) return t;
    try {
      let padded = t;
      const mod = padded.length % 4;
      if (mod !== 0) padded += '='.repeat(4 - mod);
      const binary = atob(padded);
      return new TextDecoder().decode(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      );
    } catch {
      return t;
    }
  };

  const trendingTopics = useMemo(() => {
    return trendingTopicsAll.filter((topic) => {
      if (blockedTopicSet.has(topic.key)) return false;
      if (blockedTopicSet.has(decodeBase64Topic(topic.key))) return false;
      return true;
    });
  }, [trendingTopicsAll, blockedTopicSet]);

  return (
    <>
      {trendingTopics.map((topic) => (
        <TopicListItem key={topic.key} topic={topic} mode={'trend'} />
      ))}
    </>
  );
};

const JoinedTopics = () => {
  const { processHandle } = useProcessHandleManager();
  const system = useMemo(() => processHandle.system(), [processHandle]);

  const [joinedTopicEvents, advance] = useQueryCRDTSet(
    system,
    Models.ContentType.ContentTypeJoinTopic,
    30,
  );

  useEffect(() => {
    advance();
  }, [advance]);

  const joinedTopics = useMemo(() => {
    return (
      joinedTopicEvents
        .filter((event) => event.lwwElementSet?.value)
        // @ts-ignore
        .map((event) => Util.decodeText(event.lwwElementSet.value))
    );
  }, [joinedTopicEvents]);

  return (
    <>
      {joinedTopics.map((topic) => (
        <TopicListItem
          key={topic}
          topic={{ key: topic, value: 0 }}
          mode={'history'}
        />
      ))}
    </>
  );
};

export const DesktopTopicSelector = () => {
  const [displayCategory, setDisplayCategory] = useState<
    'favorites' | 'trends'
  >('trends');

  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const scrollboxRef = useRef<HTMLDivElement>(null);

  // update scrollbar negative padding on resize (scrollbar might appear/disappear)
  useEffect(() => {
    window.addEventListener('resize', () => {
      if (scrollboxRef.current) {
        setScrollbarWidth(
          scrollboxRef.current.offsetWidth - scrollboxRef.current.clientWidth,
        );
      }
    });
  }, []);

  // monitor if searchbox is focused so we hide the scrollbar so there's only one
  const [searchboxFocused, setSearchboxFocused] = useState(false);
  const onFocusChange = useCallback((focused: boolean) => {
    setSearchboxFocused(focused);
  }, []);

  return (
    <div className="flex flex-col text-left flex-shrink min-h-0">
      <div className="flex items-center space-x-2">
        <button
          className={`h-10 w-10 flex-shrink-0 rounded-full flex justify-center items-center ${
            displayCategory === 'favorites' ? 'bg-gray-100' : 'bg-gray-50'
          }`}
          title="Favorites"
          onClick={() => setDisplayCategory('favorites')}
        >
          <StarIconSolid
            className={`h-4 w-4 ${
              displayCategory === 'favorites'
                ? 'text-gray-400'
                : 'text-gray-200'
            } group-hover:text-gray-400`}
          />
        </button>
        <button
          className={`h-10 w-10 flex-shrink-0 rounded-full flex justify-center items-center ${
            displayCategory === 'trends' ? 'bg-gray-100 ' : 'bg-gray-50'
          }`}
          title="Trends"
          onClick={() => setDisplayCategory('trends')}
        >
          <ArrowTrendingUpIcon
            strokeWidth={2}
            className={`h-5 w-5 ${
              displayCategory === 'trends' ? 'text-gray-400' : 'text-gray-200'
            } group-hover:text-gray-400`}
          />
        </button>
        <DesktopTopicSearch onFocusChange={onFocusChange} />
      </div>
      <div
        className={`flex flex-col flex-shrink pt-2 text-gray-600 text-md space-y-1
                            ${
                              searchboxFocused
                                ? 'overflow-y-hidden opacity-10'
                                : 'overflow-y-auto'
                            }`}
        ref={scrollboxRef}
        style={{ marginRight: -scrollbarWidth + 1, marginTop: -1 }}
      >
        {displayCategory === 'favorites' ? (
          <JoinedTopics />
        ) : (
          <TrendingTopics />
        )}
      </div>
    </div>
  );
};
