import {
  ArrowPathIcon,
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
import { Models } from '@polycentric/polycentric-core';
import { useModeration } from '../../../../hooks/moderationHooks';
import {
  useSystemLink,
  useUsernameCRDTQuery,
} from '../../../../hooks/queryHooks';
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
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} id="liked-icon">
    <path d="M2.75781 15.5186C2.79393 16.5133 2.95856 17.4998 3.24902 18.4531C3.43356 19.0587 4.03652 19.4668 4.74316 19.4668H5.65137C5.6664 19.4667 5.6761 19.4633 5.68457 19.458C5.69468 19.4517 5.70746 19.4395 5.71875 19.4199C5.74284 19.3778 5.74462 19.329 5.72559 19.29L5.71777 19.2725L5.44824 18.6709L5.44531 18.6631L5.44141 18.6543C5.05143 17.6913 4.81566 16.6502 4.7627 15.5615L4.75098 15.0918C4.7484 13.3555 5.22369 11.652 6.125 10.168C6.14871 10.1289 6.15213 10.0738 6.12598 10.0225C6.1139 9.99884 6.0999 9.98395 6.08887 9.97656C6.07984 9.97058 6.06915 9.9668 6.05273 9.9668H5C4.33867 9.9668 3.76485 10.3241 3.5459 10.8779C3.03268 12.1824 2.75 13.603 2.75 15.0918L2.75781 15.5186Z" />
    <path d="M6.63299 10.2168C7.43899 10.2168 8.16599 9.7708 8.66399 9.1368C9.44024 8.14641 10.4147 7.32898 11.525 6.7368C12.248 6.3528 12.875 5.7808 13.178 5.0218C13.3908 4.49005 13.5001 3.92255 13.5 3.3498V2.7168C13.5 2.51788 13.579 2.32712 13.7197 2.18647C13.8603 2.04581 14.0511 1.9668 14.25 1.9668C14.8467 1.9668 15.419 2.20385 15.841 2.62581C16.2629 3.04776 16.5 3.62006 16.5 4.2168C16.5 5.3688 16.24 6.4598 15.777 7.4348C15.511 7.9928 15.884 8.7168 16.502 8.7168H19.628C20.654 8.7168 21.573 9.4108 21.682 10.4318C21.727 10.8538 21.75 11.2818 21.75 11.7168C21.7541 14.4531 20.819 17.108 19.101 19.2378C18.713 19.7198 18.114 19.9668 17.496 19.9668H13.48C12.997 19.9668 12.516 19.8888 12.057 19.7368L8.94299 18.6968C8.48409 18.5442 8.0036 18.4665 7.51999 18.4668L6.17554 18.4395H5.90243C5.48043 17.3975 5.25099 16.2858 5.25099 15.0918C5.24841 13.4467 5.69888 11.8327 6.55299 10.4268L6.63299 10.2168Z" />
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
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} id="disliked-icon">
    <path d="M21.4922 10.4482C21.4561 9.4535 21.2914 8.467 21.001 7.5137C20.8164 6.9081 20.2135 6.5 19.5068 6.5H18.5986C18.5836 6.5001 18.5739 6.5035 18.5654 6.5088C18.5553 6.5151 18.5425 6.5273 18.5312 6.5469C18.5072 6.589 18.5054 6.6378 18.5244 6.6768L18.5322 6.6943L18.8018 7.2959L18.8047 7.3037L18.8086 7.3125C19.1986 8.2755 19.4343 9.3166 19.4873 10.4053L19.499 10.875C19.5016 12.6113 19.0263 14.3148 18.125 15.7988C18.1013 15.8379 18.0979 15.893 18.124 15.9443C18.1361 15.968 18.1501 15.9829 18.1611 15.9902C18.1702 15.9962 18.1808 16 18.1973 16H19.25C19.9113 16 20.4851 15.6427 20.7041 15.0889C21.2173 13.7844 21.5 12.3638 21.5 10.875L21.4922 10.4482Z" />
    <path d="M17.617 15.75C16.811 15.75 16.084 16.196 15.586 16.83C14.8098 17.8204 13.8353 18.6378 12.725 19.23C12.002 19.614 11.375 20.186 11.072 20.945C10.8592 21.4767 10.7499 22.0442 10.75 22.617V23.25C10.75 23.4489 10.671 23.6397 10.5303 23.7803C10.3897 23.921 10.1989 24 10 24C9.4033 24 8.831 23.763 8.409 23.341C7.9871 22.919 7.75 22.3467 7.75 21.75C7.75 20.598 8.01 19.507 8.473 18.532C8.739 17.974 8.366 17.25 7.748 17.25H4.622C3.596 17.25 2.677 16.556 2.568 15.535C2.523 15.113 2.5 14.685 2.5 14.25C2.4959 11.5137 3.431 8.8588 5.149 6.729C5.537 6.247 6.136 6 6.754 6H10.77C11.253 6 11.734 6.078 12.193 6.23L15.307 7.27C15.7659 7.4226 16.2464 7.5003 16.73 7.5L18.0745 7.5273H18.3476C18.7696 8.5693 18.999 9.681 18.999 10.875C19.0016 12.5201 18.5511 14.1341 17.697 15.54L17.617 15.75Z" />
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
    images: string[];
    url?: string;
    replyingToName?: string;
    replyingToURL?: string;
    type: 'post' | 'claim' | 'vouch';
    vouchedClaim?: {
      type: Models.ClaimType.ClaimType;
      value: string;
      system: Models.PublicKey.PublicKey;
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
    comment: (content: string, upload: File[]) => Promise<boolean>;
    delete?: () => void;
    isDeleting?: boolean;
  };
  doesLink?: boolean;
  autoExpand?: boolean;
  syncStatus?: SyncStatus;
  isMyProfile?: boolean;
  moderationTags?: Array<{ name: string; level: number }>;
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

function ClaimOwnerUsername({
  system,
}: {
  system: Models.PublicKey.PublicKey;
}) {
  const username = useUsernameCRDTQuery(system);
  const userLink = useSystemLink(system);

  return (
    <a href={userLink} className="text-blue-600 hover:underline">
      {username || 'User'}
    </a>
  );
}

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
      moderationTags,
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
          if (!status.servers || status.servers.length === 0) {
            return 'Synced to servers';
          } else {
            // Filter out duplicates and ensure just one 'local' entry
            const uniqueServers = [...new Set(status.servers)];

            // Don't show 'local' if we have other servers
            const externalServers = uniqueServers.filter((s) => s !== 'local');

            if (externalServers.length > 0) {
              return `Synced to ${
                externalServers.length
              } server(s):\n${externalServers.join('\n')}`;
            } else {
              return 'Stored locally, waiting for server acknowledgments';
            }
          }
      }
    };

    const { showModerationTags } = useModeration();

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
                  {moderationTags &&
                    moderationTags.length > 0 &&
                    showModerationTags && (
                      <div className="mt-2 text-xs text-gray-500 flex flex-col items-center">
                        <div className="font-semibold">Moderation Tags:</div>
                        {moderationTags.map((tag, index) => (
                          <div
                            key={index}
                            className="flex justify-between w-full px-1"
                          >
                            <span>{tag.name}:</span>
                            <span
                              className={`font-mono ${
                                tag.level > 0
                                  ? 'text-red-500'
                                  : 'text-green-500'
                              }`}
                            >
                              {tag.level}
                            </span>
                          </div>
                        ))}
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
                            <span className="text-sm text-gray-500 font-mono whitespace-nowrap">
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
                                if (!actions.isDeleting) {
                                  actions.delete?.();
                                }
                              }}
                              disabled={actions.isDeleting}
                              className={
                                actions.isDeleting ? 'cursor-not-allowed' : ''
                              }
                            >
                              {actions.isDeleting ? (
                                <ArrowPathIcon className="w-4 h-4 text-gray-400 animate-spin" />
                              ) : (
                                <TrashIcon className="w-4 h-4 text-gray-400" />
                              )}
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
                    {main?.type === 'vouch' && main.vouchedClaim && (
                      <div className="text-gray-600 pt-2">
                        <span>Verified a claim from </span>
                        <ClaimOwnerUsername system={main.vouchedClaim.system} />
                        <span>: {main.vouchedClaim.value}</span>
                      </div>
                    )}
                    <div onClick={(e) => e.stopPropagation()}>
                      <div className="w-fit h-fit grid grid-cols-2 gap-1">
                        {main.images.map((image) => (
                          <Zoom key={image} classDialog="custom-post-img-zoom">
                            <img
                              src={image}
                              className="rounded-2xl max-h-[10rem] max-w-[10rem] p-0 m-0 w-auto hover:opacity-80 border"
                            />
                          </Zoom>
                        ))}
                      </div>
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
