import { encode } from '@borderless/base64';
import { ArrowUpIcon, Bars3Icon } from '@heroicons/react/24/outline';
import {
    ReactElement,
    ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks';
import { useIsMobile } from '../../../hooks/styleHooks';
import { Post } from '../../feed';
import { SearchBox } from '../../search/searchbox';
import { SpinLoader } from '../../util/SpinLoader';
import './style.css';

const RightCol = ({
    children,
    verticalIpadExpanded,
}: {
    children: ReactNode;
    verticalIpadExpanded: boolean;
}) => (
    <div
        className={`h-full top-0 border-x bg-white ${
            /* for ipad viewport */ verticalIpadExpanded
                ? 'z-20 absolute right-0'
                : 'hidden sticky'
        } xl:block xl:w-[calc((100vw-776px)/2)] 2xl:w-[calc((1536px-776px)/2)] 2xl:mr-[calc((100vw-1536px)/2)] `}
    >
        <div className="flex flex-col justify-between h-full w-full">
            <div>
                <div className="p-5 pb-10">
                    <SearchBox />
                </div>
                {children}
            </div>
            <div className="p-5 w-full text-right text-gray-400 text-sm">
                <a
                    href="https://gitlab.futo.org/polycentric/polycentric"
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                >
                    Source Code
                </a>
                <a
                    href="https://docs.polycentric.io/privacy-policy/"
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                >
                    Privacy Policy
                </a>
            </div>
        </div>
    </div>
);

type InfiniteScrollWithRightColProps = {
    data: FeedHookData;
    advanceFeed: FeedHookAdvanceFn;
    nothingFound?: boolean;
    nothingFoundMessage?: string;
    rightCol?: ReactElement;
    topFeedComponent?: ReactElement;
    topFeedComponentSticky?: boolean;
    prependCount?: number;
    bottomPadding?: boolean;
    loadingSpinnerN?: number;
};

export const InfiniteScrollWithRightCol = ({
    data,
    advanceFeed,
    nothingFound,
    nothingFoundMessage = 'Sorry, nothing found',
    rightCol,
    topFeedComponent,
    topFeedComponentSticky = false,
    prependCount,
    bottomPadding = true,
    loadingSpinnerN,
}: InfiniteScrollWithRightColProps) => {
    const outerRef = useRef<HTMLDivElement>(null);
    const [showScrollUpButton, setShowScrollUpButton] = useState(false);
    const hasScrolled = useRef(false);
    const isMobile = useIsMobile();

    const [windowHeight] = useState(window.innerHeight);

    useEffect(() => {
        advanceFeed();
    }, [advanceFeed]);

    const virtuoso = useRef<VirtuosoHandle>(null);

    useLayoutEffect(() => {
        if (prependCount && prependCount > 0) {
            if (hasScrolled.current === false) {
                virtuoso.current?.scrollToIndex(prependCount);
                setShowScrollUpButton(true);
            }
        }
    }, [prependCount]);

    const onScroll = useCallback(
        (e: React.UIEvent<HTMLDivElement>) => {
            if (hasScrolled.current === false) {
                hasScrolled.current = true;
            }
            if (e.currentTarget.scrollTop > 200 && !showScrollUpButton) {
                setShowScrollUpButton(true);
            } else if (e.currentTarget.scrollTop <= 100 && showScrollUpButton) {
                setShowScrollUpButton(false);
            }
        },
        [showScrollUpButton],
    );

    const Footer = useMemo(() => {
        // eslint-disable-next-line react/display-name
        return () => <div className="h-[200vh]" />;
    }, []);

    const [verticalIpadExpanded, setVerticalIpadExpanded] = useState(false);

    const [loadingIndicatorTimeoutReached, setLoadingIndicatorTimeoutReached] =
        useState(false);
    useEffect(() => {
        // Only show loading indicator if it takes more than 500ms to load anything
        const timeout = setTimeout(() => {
            setLoadingIndicatorTimeoutReached(true);
        }, 500);

        return () => {
            clearTimeout(timeout);
            setLoadingIndicatorTimeoutReached(false);
        };
    }, []);

    const Header = useCallback(() => {
        const showLoadingIndicator =
            loadingIndicatorTimeoutReached &&
            data.length === 0 &&
            !nothingFound;

        return (
            <>
                {topFeedComponent &&
                    (topFeedComponentSticky ? (
                        <div className="sticky top-0">{topFeedComponent}</div>
                    ) : (
                        topFeedComponent
                    ))}

                {showLoadingIndicator && (
                    <div className="w-full flex justify-center">
                        <SpinLoader n={loadingSpinnerN} />
                    </div>
                )}

                {
                    // Show nothing found message if there are no posts and no loading indicator
                    nothingFound && data.length === 0 && (
                        <div className="w-full flex justify-center">
                            <div className="p-20 text-center font-light text-gray-500">
                                {nothingFoundMessage}
                            </div>
                        </div>
                    )
                }
            </>
        );
    }, [
        loadingIndicatorTimeoutReached,
        data,
        nothingFound,
        topFeedComponent,
        topFeedComponentSticky,
        loadingSpinnerN,
        nothingFoundMessage,
    ]);

    return (
        <div
            ref={outerRef} // Attach the `outerRef` to the scroll container as the custom scroll parent so it includes the left column and the padding
            className="h-full flex overflow-y-scroll noscrollbar"
            onScroll={isMobile ? undefined : onScroll}
        >
            <div className="w-full lg:w-[700px] xl:w-[776px]">
                {topFeedComponentSticky && <Header />}

                <div className="w-full h-full relative">
                    <Virtuoso
                        ref={virtuoso}
                        data={data}
                        className="noscrollbar virtuoso-root"
                        style={{ height: '100%' }}
                        customScrollParent={
                            isMobile ? undefined : outerRef.current ?? undefined
                        }
                        onScroll={isMobile ? onScroll : undefined}
                        itemContent={(index, data) => (
                            <Post
                                key={
                                    data !== undefined
                                        ? encode(data.signedEvent.signature)
                                        : index
                                }
                                autoExpand={
                                    prependCount !== undefined &&
                                    index === 100 - prependCount
                                }
                                data={data}
                            />
                        )}
                        overscan={{
                            reverse: windowHeight,
                            main: windowHeight,
                        }}
                        increaseViewportBy={{
                            top: windowHeight / 2,
                            bottom: windowHeight / 2,
                        }}
                        endReached={() => advanceFeed()}
                        components={{
                            Header:
                                topFeedComponentSticky === false
                                    ? Header
                                    : undefined,
                            Footer: bottomPadding ? Footer : undefined,
                        }}
                    />
                    {showScrollUpButton && (
                        <>
                            <div className="absolute w-full top-1 md:top-5 flex justify-center z-40">
                                <button
                                    onClick={() =>
                                        virtuoso.current?.scrollTo({
                                            top: 0,
                                            // @ts-ignore
                                            behavior: 'instant',
                                        })
                                    }
                                    className="bg-blue-500 opacity-80 md:opacity-50 hover:opacity-80 border shadow rounded-full px-14 py-2 md:p-1 text-white fixed"
                                >
                                    <ArrowUpIcon className="w-6 h-6" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
            {isMobile === false && (
                <>
                    {/* Expand Button for ipad viewport only */}
                    <button
                        className={`xl:hidden fixed top-5 h-16 w-16 rounded-full bg-white border shadow-lg z-50 flex items-center justify-center ${
                            verticalIpadExpanded ? 'right-[22rem]' : 'right-5'
                        }`}
                        onClick={() => setVerticalIpadExpanded((e) => !e)}
                    >
                        <Bars3Icon className="w-6 h-6 text-gray-600" />
                    </button>
                    <RightCol
                        verticalIpadExpanded={verticalIpadExpanded}
                        key="rightcol"
                    >
                        {rightCol}
                    </RightCol>
                </>
            )}
        </div>
    );
};
