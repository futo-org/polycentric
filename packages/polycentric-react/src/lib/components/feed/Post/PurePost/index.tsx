import { TrashIcon } from '@heroicons/react/24/outline';
import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../../../../hooks/styleHooks';
import { Profile } from '../../../../types/profile';
import { PopupComposeReplyFullscreen } from '../../../popup/PopupComposeReply';
import { ProfilePicture } from '../../../profile/ProfilePicture';
import { Link } from '../../../util/link';
import { Modal } from '../../../util/modal';

const dateToAgoString = (date: Date | undefined) => {
    if (date == null) {
        return '';
    }

    const diff = Date.now() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 24) {
        return date.toLocaleDateString();
    } else if (hours > 1) {
        return `${hours}h ago`;
    } else if (minutes > 1) {
        return `${minutes}m ago`;
    } else {
        return `${seconds}s ago`;
    }
};

export const PostActionButton = ({
    name,
    DefaultIcon,
    ClickedIcon,
    className = 'h-6 w-6 text-black',
    clickedIconClassName,
    onClick,
    count,
    clicked = false,
}: {
    name: string;
    DefaultIcon: React.FC<{ className?: string }>;
    ClickedIcon?: React.FC<{ className?: string }>;
    className?: string;
    clickedIconClassName?: string;
    onClick: () => void;
    count?: number;
    clicked?: boolean;
}) => {
    const Icon = (clicked ? ClickedIcon : DefaultIcon) ?? DefaultIcon;
    const displayClassName = clicked ? clickedIconClassName : className;
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={'flex items-center space-x-1'}
        >
            <div className="" aria-label={name}>
                <Icon className={displayClassName} />
            </div>
            {count != null && (
                <span className="text-gray-500 text-sm">{count}</span>
            )}
        </button>
    );
};

const DownvoteButton = ({ className }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className={className}
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3"
        />
    </svg>
);

const HeartIconOutline = ({ className }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
        />
    </svg>
);

const HeartIconSolid = ({ className }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
    >
        <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
    </svg>
);

const CommentIconOutline = ({ className }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className={className}
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
        />
    </svg>
);

const ShareIcon = ({ className }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className={className}
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15"
        />
    </svg>
);

export const LikeButton = ({
    onClick,
    count,
    clicked = false,
}: {
    onClick: () => void;
    count?: number;
    className?: string;
    clicked: boolean;
}) => {
    return (
        <PostActionButton
            name="Like"
            DefaultIcon={HeartIconOutline}
            ClickedIcon={HeartIconSolid}
            clickedIconClassName="w-6 h-6 text-rose-700"
            onClick={onClick}
            count={count}
            clicked={clicked}
        />
    );
};

export const DislikeButton = ({
    onClick,
    count,
    clicked = false,
}: {
    onClick: () => void;
    count?: number;
    className?: string;
    clicked: boolean;
}) => {
    return (
        <PostActionButton
            name="Dislike"
            DefaultIcon={DownvoteButton}
            className="h-5 w-5 m-0.5 text-black"
            clickedIconClassName="h-6 w-6 stroke-2"
            onClick={onClick}
            count={count}
            clicked={clicked}
        />
    );
};

const CommentButton = ({
    onClick,
    count,
}: {
    onClick: () => void;
    count?: number;
}) => {
    return (
        <PostActionButton
            name="Comment"
            DefaultIcon={CommentIconOutline}
            onClick={onClick}
            count={count}
        />
    );
};

const SharePostButton = ({ onClick }: { onClick: () => void }) => {
    return (
        <PostActionButton
            name="Share"
            DefaultIcon={ShareIcon}
            onClick={onClick}
        />
    );
};

export interface PurePostProps {
    main?: {
        content: string;
        author: Profile;
        publishedAt?: Date;
        topic?: string;
        image?: string;
        // URLs aren't synchronous because we need to get the list of servers
        url?: string;
        replyingToName?: string;
        replyingToURL?: string;
    };
    sub?: {
        content: string;
        author: Profile;
        publishedAt?: Date;
        topic: string;
        image?: string;
        ContentLink?: string;
        url?: string;
    };
    stats?: {
        likes?: number;
        dislikes?: number;
        opinion: 'liked' | 'disliked' | 'neutral';
        comments?: number;
    };
    actions?: {
        like: () => void;
        dislike: () => void;
        neutralopinion: () => void;
        repost: () => void;
        comment: (content: string, upload?: File) => Promise<boolean>;
        delete?: () => void;
    };
    doesLink?: boolean;
    autoExpand?: boolean;
}

const PostLinkContainer = ({
    children,
    doesLink,
    url,
}: {
    children: React.ReactNode;
    doesLink?: boolean;
    url?: string;
}) => {
    const linkRef = useRef<HTMLAnchorElement>(null);

    return (
        <>
            <div
                onClick={() => {
                    if (doesLink) {
                        linkRef.current?.click();
                    }
                }}
            >
                {children}
            </div>
            <Link
                routerLink={url}
                routerDirection="forward"
                className="hidden"
                ref={linkRef}
            />
        </>
    );
};

const basicURLRegex = /^(https?:\/\/)?(www\.)?/;

// eslint-disable-next-line react/display-name
export const PurePost = forwardRef<HTMLDivElement, PurePostProps>(
    (
        {
            main,
            sub,
            stats,
            actions,
            doesLink = true,
            autoExpand = false,
        }: PurePostProps,
        infiniteScrollRef,
    ) => {
        const mainRef = useRef<HTMLDivElement>(null);
        const subContentRef = useRef<HTMLDivElement>(null);
        const [contentCropped, setContentCropped] = useState(false);
        const [expanded, setExpanded] = useState(autoExpand);
        const [subcontentCropped, setsubcontentCropped] = useState(false);
        const [commentPanelOpen, setCommentPanelOpen] = useState(false);
        const [mainImageOpen, setMainImageOpen] = useState(false);
        const [mainHover, setMainHover] = useState(false);
        const [subHover, setSubHover] = useState(false);

        const topicLink = useMemo(() => {
            if (main?.topic) {
                if (main.topic.startsWith('/')) {
                    return `/t/-${main.topic}`;
                }
                return `/t/${main.topic}`;
            } else {
                return undefined;
            }
        }, [main?.topic]);

        const isMobile = useIsMobile();
        const displayTopic = useMemo(() => {
            if (main?.topic && isMobile) {
                return main.topic.replace(basicURLRegex, '');
            } else {
                return main?.topic;
            }
        }, [main?.topic, isMobile]);

        const hoverStylePost = doesLink && mainHover && !subHover;

        useLayoutEffect(() => {
            if (
                mainRef.current != null &&
                expanded === false &&
                autoExpand === false
            ) {
                setContentCropped(
                    mainRef.current.clientHeight < mainRef.current.scrollHeight,
                );
            }
        }, [main, expanded, autoExpand]);

        useLayoutEffect(() => {
            if (subContentRef.current != null) {
                setsubcontentCropped(
                    subContentRef.current.clientHeight <
                        subContentRef.current.scrollHeight,
                );
            }
        }, [sub]);

        return (
            <div ref={infiniteScrollRef}>
                {main == null ? (
                    <div className="p-14 border-b border-gray-100 bg-white">
                        <div className="w-full animate-pulse border border-blue-100 rounded-2xl h-5"></div>
                    </div>
                ) : (
                    <PostLinkContainer doesLink={doesLink} url={main.url}>
                        <article
                            className={`px-3 pt-5 pb-3 lg:px-10 lg:pt-10 lg:pb-8 border-b border-gray-100  inline-block w-full ${
                                doesLink
                                    ? ' transition-colors duration-200 ease-in-out group'
                                    : ''
                            } ${
                                doesLink && hoverStylePost ? 'bg-gray-50' : ''
                            } ${hoverStylePost ? 'bg-gray-50' : 'bg-white'}`}
                            onMouseEnter={() => {
                                setMainHover(true);
                            }}
                            onMouseLeave={() => setMainHover(false)}
                        >
                            <div className="grid grid-cols-[fit-content(100%)_1fr] relative">
                                {/* Left column */}
                                <div className="mr-3 lg:mr-4 flex-shrink-0 flex flex-col ">
                                    {/* Stop pfp link propagation to post link */}
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <Link
                                            routerLink={main.author.URL}
                                            routerDirection="forward"
                                        >
                                            <ProfilePicture
                                                src={main.author.avatarURL}
                                                className="h-16 w-16 md:h-20 md:w-20"
                                            />
                                        </Link>
                                    </div>
                                    {(!isMobile ||
                                        (isMobile &&
                                            contentCropped &&
                                            expanded)) && (
                                        <div
                                            className={`flex-col space-y-5 md:space-y-2 ${
                                                expanded ? 'sticky top-1/2' : ''
                                            }  ${
                                                // sub == null ? 'pt-5' : ''
                                                'pt-5'
                                            }`}
                                        >
                                            <LikeButton
                                                onClick={() =>
                                                    stats?.opinion === 'liked'
                                                        ? actions?.neutralopinion()
                                                        : actions?.like()
                                                }
                                                count={
                                                    isMobile
                                                        ? undefined
                                                        : stats?.likes
                                                }
                                                clicked={
                                                    stats?.opinion ===
                                                        'liked' ?? false
                                                }
                                            />
                                            <DislikeButton
                                                onClick={() =>
                                                    stats?.opinion ===
                                                    'disliked'
                                                        ? actions?.neutralopinion()
                                                        : actions?.dislike()
                                                }
                                                count={
                                                    isMobile
                                                        ? undefined
                                                        : stats?.dislikes
                                                }
                                                clicked={
                                                    stats?.opinion ===
                                                        'disliked' ?? false
                                                }
                                            />
                                            {isMobile === false && (
                                                <>
                                                    <CommentButton
                                                        onClick={() => {
                                                            setCommentPanelOpen(
                                                                true,
                                                            );
                                                        }}
                                                        count={
                                                            isMobile
                                                                ? undefined
                                                                : stats?.comments
                                                        }
                                                    />
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {/* Right column */}
                                <div className="flex-grow w-full min-w-0 lg:max-w-[600px]">
                                    <div className="flex w-full justify-between">
                                        <div
                                            className="w-full"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="flex w-full justify-between space-x-3 items-center">
                                                <Link
                                                    routerLink={
                                                        // On mobile, don't allow this to be a link so the topic is easier to click
                                                        isMobile
                                                            ? undefined
                                                            : main.author.URL
                                                    }
                                                    className="text-inherit flex-shrink min-w-0"
                                                >
                                                    <address className="font-bold text-base author not-italic hover:underline h-[1.5rem] w-full overflow-hidden overflow-ellipsis">
                                                        {main.author.name}
                                                    </address>
                                                </Link>
                                                <time className="text-right sm:text-right font-light text-gray-400 sm:text-sm flex-grow min-w-max">
                                                    {dateToAgoString(
                                                        main.publishedAt,
                                                    )}
                                                </time>
                                                {
                                                    // Only show the delete button if the post is deletable
                                                    actions?.delete && (
                                                        <button
                                                            onClick={() => {
                                                                actions.delete?.();
                                                            }}
                                                        >
                                                            <TrashIcon className="w-4 h-4 text-gray-400" />
                                                        </button>
                                                    )
                                                }
                                            </div>
                                            <div className="h-[1.5rem] w-4/5 min-w-0 text-gray-300 whitespace-nowrap">
                                                {main.replyingToName ? (
                                                    <Link
                                                        routerLink={
                                                            main.replyingToURL
                                                        }
                                                        className="text-black w-full block overflow-hidden text-ellipsis"
                                                    >
                                                        Replying to{' '}
                                                        <span className="text-gray-500">
                                                            {
                                                                main.replyingToName
                                                            }
                                                        </span>
                                                    </Link>
                                                ) : main.topic ? (
                                                    <Link
                                                        routerLink={topicLink}
                                                        className="text-gray-300 w-full block overflow-hidden text-ellipsis"
                                                    >
                                                        {displayTopic}
                                                    </Link>
                                                ) : undefined}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col space-y-3">
                                        {/* Actual post content */}
                                        <main
                                            className={
                                                'pt-4 leading-normal whitespace-pre-line text-lg text-gray-900 font-normal overflow-hidden text-pretty break-words' +
                                                (expanded
                                                    ? ''
                                                    : ' line-clamp-[7]') +
                                                (contentCropped && !expanded
                                                    ? ` line-clamp-[7] relative
                  after:top-0 after:left-0  after:w-full after:h-full 
                  after:bg-gradient-to-b after:from-80% after:from-transparent
                  after:absolute ${
                      hoverStylePost ? 'after:to-gray-50' : 'after:to-white'
                  }`
                                                    : '')
                                            }
                                            ref={mainRef}
                                        >
                                            {main.content}
                                        </main>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                main.image &&
                                                    setMainImageOpen(true);
                                            }}
                                        >
                                            <img
                                                src={main.image}
                                                className="rounded-2xl max-h-60 max-w-full w-auto hover:opacity-80 border"
                                            />
                                        </button>
                                        {/* sub.post */}
                                        {sub && (
                                            <Link
                                                className="border rounded-2xl w-full p-5 bg-white hover:bg-gray-50 overflow-clip flex flex-col space-y-3"
                                                routerLink={sub.url}
                                            >
                                                <div className="flex">
                                                    <Link
                                                        routerLink={
                                                            sub.author.URL
                                                        }
                                                    >
                                                        <ProfilePicture
                                                            src={
                                                                sub.author
                                                                    .avatarURL
                                                            }
                                                            className="h-5 w-5 lg:h-10 lg:w-10"
                                                        />
                                                    </Link>
                                                    <div className="flex flex-col ml-2 w-full">
                                                        <div className="flex justify-between w-full">
                                                            <div className="font-bold">
                                                                {
                                                                    sub.author
                                                                        .name
                                                                }
                                                            </div>
                                                            <div className="pr-3 lg:pr-0 font-light text-gray-500 text-sm">
                                                                {dateToAgoString(
                                                                    sub.publishedAt,
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className=" text-purple-400 leading-3 text-sm">
                                                            {sub.topic}
                                                        </div>
                                                    </div>
                                                </div>
                                                <main
                                                    ref={subContentRef}
                                                    className={`line-clamp-[4]  ${
                                                        subcontentCropped
                                                            ? `relative after:top-0 after:left-0  after:w-full after:h-full 
                        after:bg-gradient-to-b after:from-20% after:from-transparent after:to-white group-hover:after:to-slate-50
                        after:absolute`
                                                            : ''
                                                    }`}
                                                >
                                                    {sub.content}
                                                </main>
                                            </Link>
                                        )}
                                    </div>
                                </div>
                                {contentCropped && !expanded && (
                                    // Bot columns so it's centered
                                    <div className="col-span-2 flex w-full justify-center mt-4">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setExpanded(true);
                                            }}
                                            className="bg-gray-200 rounded-full font-bold px-10 z-10 py-3"
                                            onMouseEnter={() =>
                                                setSubHover(true)
                                            }
                                            onMouseLeave={() =>
                                                setSubHover(false)
                                            }
                                        >
                                            Read more
                                        </button>
                                    </div>
                                )}
                                {/* Left column */}
                                <div className="col-start-2 lg:hidden flex justify-between pt-6">
                                    <CommentButton
                                        onClick={() => {
                                            setCommentPanelOpen(true);
                                        }}
                                        count={stats?.comments}
                                    />
                                    <DislikeButton
                                        onClick={() =>
                                            stats?.opinion === 'disliked'
                                                ? actions?.neutralopinion()
                                                : actions?.dislike()
                                        }
                                        count={stats?.dislikes}
                                        clicked={
                                            stats?.opinion === 'disliked' ??
                                            false
                                        }
                                    />
                                    <LikeButton
                                        onClick={() =>
                                            stats?.opinion === 'liked'
                                                ? actions?.neutralopinion()
                                                : actions?.like()
                                        }
                                        count={stats?.likes}
                                        clicked={
                                            stats?.opinion === 'liked' ?? false
                                        }
                                    />
                                    {navigator.share && (
                                        <SharePostButton
                                            onClick={() => {
                                                main.url &&
                                                    main.author.name &&
                                                    navigator.share({
                                                        title: `${
                                                            main.author.name
                                                        } posted on Polycentric: ${main.content.substring(
                                                            0,
                                                            20,
                                                        )}...`,
                                                        url: main.url,
                                                    });
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                                <PopupComposeReplyFullscreen
                                    open={commentPanelOpen}
                                    main={main}
                                    sub={sub}
                                    setOpen={(open) =>
                                        setCommentPanelOpen(open)
                                    }
                                    onComment={actions?.comment}
                                />
                                <Modal
                                    open={mainImageOpen}
                                    setOpen={(open) => setMainImageOpen(open)}
                                    shrink={false}
                                >
                                    <div className="m-5">
                                        <img
                                            className="rounded-2xl w-[80vw] lg:w-[60vw] h-auto"
                                            src={main.image}
                                        />
                                    </div>
                                </Modal>
                            </div>
                        </article>
                    </PostLinkContainer>
                )}
            </div>
        );
    },
);
