import { Menu } from '@headlessui/react';
import { Models, Util } from '@polycentric/polycentric-core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProcessHandleManager } from '../../../../../hooks/processHandleManagerHooks';
import {
    useQueryIfAdded,
    useQueryTopStringReferences,
} from '../../../../../hooks/queryHooks';
import { useTopicLink } from '../../../../../hooks/utilHooks';
import { numberTo4Chars } from '../../../../../util/etc';
import { Link } from '../../../../util/link';

const TopicSearchItem = ({
    topic,
}: {
    topic: Models.AggregationBucket.Type;
}) => {
    const { processHandle } = useProcessHandleManager();
    const encodedTopic = useMemo(() => Util.encodeText(topic.key), [topic.key]);
    const joinedTopic = useQueryIfAdded(
        Models.ContentType.ContentTypeJoinTopic,
        processHandle.system(),
        encodedTopic,
    );

    const quantityString = useMemo(() => numberTo4Chars(topic.value), [topic]);

    const topicLink = useTopicLink(topic.key);

    return (
        <Menu.Item key={topic.key}>
            <Link
                className="h-12 p-1 rounded-l-full rounded-r flex items-center space-x-2 text-left 
group hover:bg-gray-100 transition-colors duration-200 cursor-pointer max-w-full"
                routerLink={topicLink}
                routerDirection="root"
            >
                <div
                    className={`h-10 aspect-square  rounded-full flex justify-center items-center text-xs ${
                        joinedTopic ? 'bg-blue-200 bg-opacity-30' : 'bg-gray-50'
                    }`}
                >
                    {quantityString}
                </div>
                <div className="flex-grow pl-4 overflow-ellipsis overflow-hidden min-w-0">
                    {topic.key}
                </div>
            </Link>
        </Menu.Item>
    );
};

export const DesktopTopicSearch = ({
    onFocusChange,
}: {
    onFocusChange?: (focused: boolean) => void;
}) => {
    const [topicSearchQuery, setTopicSearchQuery] = useState('');
    const [topicSearchFocus, setTopicSearchFocus] = useState(false);
    const topicSearchResults = useQueryTopStringReferences(topicSearchQuery, 3);

    const searchBoxBlurTimeout = useRef<number | null>(null);

    const onSearchboxBlur = () => {
        if (!searchBoxBlurTimeout.current) {
            searchBoxBlurTimeout.current = window.setTimeout(() => {
                setTopicSearchFocus(false);
                onFocusChange?.(false);
                searchBoxBlurTimeout.current = null;
            }, 50);
        }
    };

    useLayoutEffect(() => {
        menuItemsRef.current?.scrollTo(0, 0);
    }, [topicSearchResults]);

    const menuItemsRef = useRef<HTMLDivElement>(null);

    return (
        <Menu as="div" className="flex-grow relative">
            <input
                className={`rounded-l-full rounded-tr-full w-full p-2 pl-4 border 
                            border-gray-100 focus:outline-none 
                            placeholder:font-light focus:shadow-lg ${
                                topicSearchFocus ? 'shadow-lg' : ''
                            }
                            ${
                                topicSearchQuery === '/'
                                    ? 'text-gray-400'
                                    : 'text-gray-800'
                            }
                            `}
                placeholder="Search Topics"
                value={topicSearchQuery}
                onChange={(e) => {
                    setTopicSearchQuery(e.target.value);
                }}
                onBlur={onSearchboxBlur}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                onFocus={(e) => {
                    if (searchBoxBlurTimeout.current) {
                        clearTimeout(searchBoxBlurTimeout.current);
                        searchBoxBlurTimeout.current = null;
                    }
                    setTopicSearchFocus(true);
                    onFocusChange?.(true);
                    if (e.target.value === '') {
                        // manually set it before react does it so we ensure cursor
                        e.target.value = '/';
                        setTopicSearchQuery('/');
                        // put cursor at end of new value
                        e.target.selectionStart = 2;
                    }
                }}
            />
            {topicSearchFocus && topicSearchResults.length > 0 && (
                <Menu.Items
                    className={`absolute top-11 right-0 rounded-[1.5rem] rounded-tr-none border border-gray-100 bg-white w-[calc(100%_+_2.5rem_+_1.0rem)] h-64 shadow-lg pl-1 pt-1 flex flex-col overflow-y-auto`}
                    ref={menuItemsRef}
                    static={true}
                    onFocus={() => {
                        if (searchBoxBlurTimeout.current) {
                            clearTimeout(searchBoxBlurTimeout.current);
                            searchBoxBlurTimeout.current = null;
                        }
                    }}
                    onBlur={onSearchboxBlur}
                >
                    {topicSearchResults.map((topic) => (
                        <TopicSearchItem key={topic.key} topic={topic} />
                    ))}
                </Menu.Items>
            )}
        </Menu>
    );
};
