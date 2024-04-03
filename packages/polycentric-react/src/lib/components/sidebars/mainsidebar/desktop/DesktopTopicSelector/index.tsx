import { ArrowTrendingUpIcon } from '@heroicons/react/24/outline';
import { StarIcon } from '@heroicons/react/24/solid';
import { Models, Util } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProcessHandleManager } from '../../../../../hooks/processHandleManagerHooks';
import {
    useQueryCRDTSet,
    useQueryTopStringReferences,
} from '../../../../../hooks/queryHooks';
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

    const [hovered, setHovered] = useState(false);

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

    return (
        <Link
            className="h-12 p-1 rounded-l-full rounded-r flex items-center space-x-2 ml-11 text-left 
    group hover:bg-gray-100 transition-colors duration-200 cursor-pointer"
            activeClassName={'bg-gray-100 text-gray-800'}
            key={topic.key}
            routerLink={'/t/' + topic.key.replace(/^\//, '')}
            routerDirection="root"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
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
                        processHandle
                            .joinTopic(topic.key)
                            .then(() => void refreshIfAdded());
                    }
                }}
            >
                {mode === 'trend' && !hovered ? (
                    <div
                        className={`h-10 aspect-square text-xs text-gray-900 rounded-full flex 
                                    justify-center items-center bg-opacity-30
                                    ${topicJoined ? 'bg-blue-200' : ''}`}
                    >
                        {valueString}
                    </div>
                ) : (
                    <div
                        className={`h-10 aspect-square rounded-full 
                                    flex justify-center items-center bg-opacity-30 
                                     ${
                                         topicJoined
                                             ? 'bg-blue-200'
                                             : 'hover:bg-gray-50 hover:bg-opacity-50'
                                     }`}
                    >
                        <StarIcon
                            className={`h-6 w-6 text-gray-200 group-hover:text-slate-300`}
                        />
                    </div>
                )}
            </button>
            <div className="flex-grow pl-4">{topic.key}</div>
        </Link>
    );
};

const TrendingTopics = () => {
    const trendingTopics = useQueryTopStringReferences(undefined);

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
                    scrollboxRef.current.offsetWidth -
                        scrollboxRef.current.clientWidth,
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
        <div className="flex flex-col space-y-0 text-left flex-shrink min-h-0">
            <div className="flex items-center space-x-2">
                <button
                    className={`h-10 w-10 flex-shrink-0 rounded-full flex justify-center items-center ${
                        displayCategory === 'favorites'
                            ? 'bg-gray-100'
                            : 'bg-gray-50'
                    }`}
                    title="Favorites"
                    onClick={() => setDisplayCategory('favorites')}
                >
                    <StarIcon
                        className={`h-4 w-4 ${
                            displayCategory === 'favorites'
                                ? 'text-gray-400'
                                : 'text-gray-200'
                        } group-hover:text-gray-400`}
                    />
                </button>
                <button
                    className={`h-10 w-10 flex-shrink-0 rounded-full flex justify-center items-center ${
                        displayCategory === 'trends'
                            ? 'bg-gray-100 '
                            : 'bg-gray-50'
                    }`}
                    title="Trends"
                    onClick={() => setDisplayCategory('trends')}
                >
                    <ArrowTrendingUpIcon
                        strokeWidth={2}
                        className={`h-5 w-5 ${
                            displayCategory === 'trends'
                                ? 'text-gray-400'
                                : 'text-gray-200'
                        } group-hover:text-gray-400`}
                    />
                </button>
                <DesktopTopicSearch onFocusChange={onFocusChange} />
            </div>
            <div
                className={`flex flex-col flex-shrink space-y-1 pt-1 text-gray-600 text-lg
                            ${
                                searchboxFocused
                                    ? 'overflow-y-hidden'
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
