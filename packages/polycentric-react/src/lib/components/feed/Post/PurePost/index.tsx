import {
  CloudArrowUpIcon,
  CloudIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import React, {
  forwardRef,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Zoom from 'react-medium-image-zoom';
import 'react-medium-image-zoom/dist/styles.css';
import { useIsMobile } from '../../../../hooks/styleHooks';
import { Profile } from '../../../../types/profile';
import { PopupComposeReplyFullscreen } from '../../../popup/PopupComposeReply';
import { ProfilePicture } from '../../../profile/ProfilePicture';
import { Link } from '../../../util/link';
import { Linkify } from '../../../util/linkify';
// Styling for image viewer
import { Tooltip } from '@mui/material';
import { useTopicLink } from '../../../../hooks/utilHooks';
import './style.css';

const dateToAgoString = (date: Date | undefined) => {
  if (date == null) {
    return '';
  }

  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  // If the date is in the future, return the time just HH:MM
  if (date.getTime() > Date.now()) {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

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
      {count != null && <span className="text-gray-500 text-sm">{count}</span>}
    </button>
  );
};

const LikeIconOutline = ({ className }: { className?: string }) => (
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
      d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z"
    />
  </svg>
);

const LikeIconSolid = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M7.493 18.75c-.425 0-.82-.236-.975-.632A7.48 7.48 0 016 15.375c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23h-.777M2.331 18.75A6.75 6.75 0 019 12h.75v6.75a2.25 2.25 0 01-2.25 2.25h-3a2.25 2.25 0 01-2.169-1.5z" />
  </svg>
);

const DislikeIconOutline = ({ className }: { className?: string }) => (
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
      d="M7.5 15h2.25m8.024-9.75c.011.05.028.1.052.148.591 1.2.924 2.55.924 3.977a8.96 8.96 0 01-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398C20.613 14.547 19.833 15 19 15h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 00.303-.54m.023-8.25H16.48a4.5 4.5 0 01-1.423-.23l-3.114-1.04a4.5 4.5 0 00-1.423-.23H6.504c-.618 0-1.217.247-1.605.729A11.95 11.95 0 002.25 12c0 .434.023.863.068 1.285C2.427 14.306 3.346 15 4.372 15h3.126c.618 0 .991.724.725 1.282A7.471 7.471 0 007.5 19.5a2.25 2.25 0 002.25 2.25.75.75 0 00.75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 002.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384"
    />
  </svg>
);

const DislikeIconSolid = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M15.73 5.25h1.035A7.465 7.465 0 0118 9.375a7.465 7.465 0 01-1.235 4.125h-.148c-.806 0-1.534.446-2.031 1.08a9.04 9.04 0 01-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 00-.322 1.672V21a.75.75 0 01-.75.75 2.25 2.25 0 01-2.25-2.25c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H3.622c-1.026 0-1.945-.694-2.054-1.715A12.134 12.134 0 011.5 12c0-2.848.992-5.464 2.649-7.521.388-.482.987-.729 1.605-.729H9.77a4.5 4.5 0 011.423.23l3.114 1.04a4.5 4.5 0 001.423.23zM21.669 13.5c0 .414-.336.75-.75.75h-5.19a3.75 3.75 0 01-3.729-3.75V9h9.669a.75.75 0 01.75.75v3.75z" />
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

const RepostIcon = ({ className }: { className?: string }) => (
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
      d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3"
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
      DefaultIcon={LikeIconOutline}
      ClickedIcon={LikeIconSolid}
      clickedIconClassName="w-6 h-6 text-blue-600"
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
      DefaultIcon={DislikeIconOutline}
      ClickedIcon={DislikeIconSolid}
      className="h-6 w-6 text-black"
      clickedIconClassName="h-6 w-6 text-gray-600"
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
    <PostActionButton name="Share" DefaultIcon={ShareIcon} onClick={onClick} />
  );
};

const RepostButton = ({ onClick }: { onClick: () => void }) => {
  return (
    <PostActionButton
      name="Repost"
      DefaultIcon={RepostIcon}
      onClick={onClick}
    />
  );
};

interface SyncStatus {
  state: 'offline' | 'syncing' | 'acknowledged';
  acknowledgedServers: number;
  // Add servers information
  servers?: string[];
}

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
    type: 'post' | 'claim' | 'vouch';
    repostedContent?: {
      content: string;
      author: {
        name?: string;
        avatarURL?: string;
        URL?: string;
        pubkey?: string;
      };
      postURL?: string;
    };
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
  syncStatus?: SyncStatus;
  isMyProfile?: boolean;
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

export const PurePost = forwardRef<HTMLDivElement, PurePostProps>(
  (
    {
      main,
      sub,
      stats,
      actions,
      doesLink = true,
      autoExpand = false,
      syncStatus,
      isMyProfile,
    }: PurePostProps,
    infiniteScrollRef,
  ) => {
    const mainRef = useRef<HTMLDivElement>(null);
    const subContentRef = useRef<HTMLDivElement>(null);
    const [contentCropped, setContentCropped] = useState(false);
    const [expanded, setExpanded] = useState(autoExpand);
    const [subcontentCropped, setsubcontentCropped] = useState(false);
    const [commentPanelOpen, setCommentPanelOpen] = useState(false);
    const [mainHover, setMainHover] = useState(false);
    const [subHover, setSubHover] = useState(false);

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

    const topicLink = useTopicLink(main?.topic);

    const getSyncTooltip = (status: SyncStatus) => {
      switch (status.state) {
        case 'offline':
          return 'Offline - Cannot sync';
        case 'syncing':
          return 'Syncing...';
        case 'acknowledged':
          return `Synced to servers:\n${
            status.servers?.join('\n') || 'local only'
          }`;
      }
    };

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
              } ${doesLink && hoverStylePost ? 'bg-gray-50' : ''} ${
                hoverStylePost ? 'bg-gray-50' : 'bg-white'
              }`}
              onMouseEnter={() => {
                setMainHover(true);
              }}
              onMouseLeave={() => setMainHover(false)}
            >
              <div className="grid grid-cols-[fit-content(100%)_1fr] relative">
                {/* Left column */}
                <div className="mr-3 lg:mr-4 flex-shrink-0">
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
                  {syncStatus && isMyProfile && (
                    <div className="mt-2 flex justify-center">
                      <Tooltip
                        title={
                          syncStatus ? getSyncTooltip(syncStatus) : undefined
                        }
                      >
                        <div>
                          {syncStatus.state === 'offline' && (
                            <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500" />
                          )}
                          {syncStatus.state === 'syncing' && (
                            <CloudArrowUpIcon className="h-6 w-6 text-blue-500 animate-pulse" />
                          )}
                          {syncStatus.state === 'acknowledged' && (
                            <CloudIcon className="h-6 w-6 text-green-500" />
                          )}
                        </div>
                      </Tooltip>
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
                            isMobile ? undefined : main.author.URL
                          }
                          className="text-inherit flex-shrink min-w-0"
                        >
                          <div className="flex items-center gap-2">
                            <address className="font-bold text-base author not-italic hover:underline h-[1.5rem] w-full overflow-hidden overflow-ellipsis text-black">
                              {main.author.name}
                            </address>
                            <span className="text-sm text-gray-500 font-mono">
                              {main.author.pubkey}
                            </span>
                          </div>
                        </Link>
                        <time className="text-right sm:text-right font-light text-gray-400 sm:text-sm flex-grow min-w-max">
                          {dateToAgoString(main.publishedAt)}
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
                            routerLink={main.replyingToURL}
                            className="text-black w-full block overflow-hidden text-ellipsis"
                          >
                            Replying to{' '}
                            <span className="text-gray-500">
                              {main.replyingToName}
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
                    <Linkify
                      as="main"
                      className={
                        'pt-4 leading-normal whitespace-pre-line text-lg text-gray-900 font-normal overflow-hidden text-pretty break-words' +
                        (expanded ? '' : ' line-clamp-[7]') +
                        (contentCropped && !expanded
                          ? ` line-clamp-[7] relative
                                                            after:top-0 after:left-0  after:w-full after:h-full 
                                                            after:bg-gradient-to-b after:from-80% after:from-transparent
                                                            after:absolute ${
                                                              hoverStylePost
                                                                ? 'after:to-gray-50'
                                                                : 'after:to-white'
                                                            }`
                          : '')
                      }
                      ref={mainRef}
                      content={main.content}
                      stopPropagation={true}
                    />
                    <div onClick={(e) => e.stopPropagation()} className="w-fit">
                      <Zoom classDialog="custom-post-img-zoom">
                        <img
                          src={main.image}
                          className="rounded-2xl max-h-60 max-w-full w-auto hover:opacity-80 border"
                        />
                      </Zoom>
                      {/* sub.post */}
                      {sub && (
                        <Link
                          className="border rounded-2xl w-full p-5 bg-white hover:bg-gray-50 overflow-clip flex flex-col space-y-3"
                          routerLink={sub.url}
                        >
                          <div className="flex">
                            <ProfilePicture
                              src={sub.author.avatarURL}
                              className="h-5 w-5 lg:h-10 lg:w-10"
                            />
                            <div className="flex flex-col ml-2 w-full">
                              <div className="flex justify-between w-full">
                                <div className="font-bold text-black">
                                  {sub.author.name}
                                </div>
                                <div className="pr-3 lg:pr-0 font-light text-gray-500 text-sm">
                                  {dateToAgoString(sub.publishedAt)}
                                </div>
                              </div>
                              <div className=" text-purple-400 leading-3 text-sm">
                                {sub.topic}
                              </div>
                            </div>
                          </div>
                          <Linkify
                            as="sub"
                            ref={subContentRef}
                            // Don't let the links within be clickable
                            className={`pointer-events-none line-clamp-[4] 
                                                                     ${
                                                                       subcontentCropped
                                                                         ? ` relative after:top-0 after:left-0  after:w-full after:h-full 
                                                                after:bg-gradient-to-b after:from-20% after:from-transparent after:to-white group-hover:after:to-slate-50
                                                                after:absolute`
                                                                         : ''
                                                                     }`}
                            content={sub.content}
                            stopPropagation={true}
                          />
                        </Link>
                      )}
                    </div>
                    {main.repostedContent && (
                      <div className="mt-3 border rounded-md p-3 bg-gray-50">
                        <div
                          className="border-l-4 border-gray-300 pl-3 cursor-pointer hover:bg-gray-100 transition-colors rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (main.repostedContent?.postURL) {
                              window.location.href =
                                main.repostedContent.postURL;
                            }
                          }}
                        >
                          <div className="flex items-center mb-2">
                            <ProfilePicture
                              src={main.repostedContent.author.avatarURL}
                              alt={main.repostedContent.author.name || 'User'}
                              className="w-8 h-8"
                            />
                            <div className="ml-2">
                              <div className="font-medium">
                                {main.repostedContent.author.name}
                              </div>
                              <div className="text-gray-500 text-xs">
                                {main.repostedContent.author.pubkey}
                              </div>
                            </div>
                          </div>
                          <div className="whitespace-pre-wrap">
                            {main.repostedContent.content}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Action buttons - equally spaced */}
                <div className="col-start-2 flex justify-between px-12 pt-6">
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
                    clicked={stats?.opinion === 'disliked'}
                  />
                  <LikeButton
                    onClick={() =>
                      stats?.opinion === 'liked'
                        ? actions?.neutralopinion()
                        : actions?.like()
                    }
                    count={stats?.likes}
                    clicked={stats?.opinion === 'liked'}
                  />
                  <RepostButton onClick={() => actions?.repost()} />
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
                  setOpen={(open) => setCommentPanelOpen(open)}
                  onComment={actions?.comment}
                />
                {/* {mainImageOpen && main.image && (
                                    <SingleImageViewer
                                        src={main.image}
                                        onClose={() => setMainImageOpen(false)}
                                    />
                                )} */}
              </div>
              {contentCropped && !expanded && (
                // Both columns so it's centered
                <div className="col-span-2 flex w-full justify-center mt-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(true);
                    }}
                    className="bg-gray-200 rounded-full font-bold px-10 z-10 py-3 text-black"
                    onMouseEnter={() => setSubHover(true)}
                    onMouseLeave={() => setSubHover(false)}
                  >
                    Read more
                  </button>
                </div>
              )}
            </article>
          </PostLinkContainer>
        )}
      </div>
    );
  },
);

PurePost.displayName = 'PurePost';
