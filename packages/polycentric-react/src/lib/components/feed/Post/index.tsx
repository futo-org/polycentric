import { Models, Protocol, Util } from '@polycentric/polycentric-core';
import Long from 'long';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { FeedItem } from '../../../hooks/feedHooks';
import {
  useAvatar,
  useImageManifestDisplayURL,
} from '../../../hooks/imageHooks';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import {
  useDateFromUnixMS,
  useEventLink,
  useSystemLink,
  useTextPublicKey,
  useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { useRepostedPost } from '../../../hooks/repostHooks';
import { usePostStatsWithLocalActions } from '../../../hooks/statsHooks';
import { RepostDialog } from '../../popup/PopupComposeRepost';
import { getAccountUrl } from '../../util/linkify/utils';
import { PurePost, PurePostProps } from './PurePost';

interface PostProps {
  data: FeedItem | undefined;
  doesLink?: boolean;
  autoExpand?: boolean;
  isNewPost?: boolean;
}

interface LoadedPostProps {
  data: FeedItem;
  doesLink?: boolean;
  autoExpand?: boolean;
  syncStatus?: {
    state: 'offline' | 'syncing' | 'acknowledged';
    acknowledgedServers: number;
    servers?: string[];
  };
  isMyProfile: boolean;
  actions?: {
    like: () => void;
    dislike: () => void;
    neutralopinion: () => void;
    repost: () => void;
    comment: (content: string, upload?: File | undefined) => Promise<boolean>;
    delete?: (() => void) | undefined;
  };
}

const LoadedPost = forwardRef<HTMLDivElement, LoadedPostProps>(
  ({ data, doesLink, autoExpand, syncStatus, isMyProfile, actions }, ref) => {
    const { value, event, signedEvent } = data;

    const content = useMemo(() => {
      if ('content' in value) {
        return value.content;
      } else if ('claimType' in value) {
        const claimType = value.claimType as Models.ClaimType.ClaimType;
        const claimValue = value.claimFields[0]?.value || '';

        if (claimType.equals(Models.ClaimType.ClaimTypeOccupation)) {
          return `Claimed they work at ${value.claimFields[0].value} as ${value.claimFields[1].value} in ${value.claimFields[2].value}.`;
        } else if (claimType.equals(Models.ClaimType.ClaimTypeSkill)) {
          return `Claimed skill: ${claimValue}`;
        } else if (claimType.equals(Models.ClaimType.ClaimTypeGeneric)) {
          return `Claimed: ${claimValue}`;
        } else {
          const platformName = Models.ClaimType.toString(claimType);
          return `Claimed ${platformName} account: ${claimValue}`;
        }
      } else if ('vouchType' in value) {
        return 'Vouched for claim';
      }
      return '';
    }, [value]);

    const topic = useMemo(() => {
      if ('content' in value) {
        const { references } = event;
        const topicRef = references.find((ref) => ref.referenceType.eq(3));
        return topicRef ? Util.decodeText(topicRef.reference) : undefined;
      } else if ('claimType' in value) {
        const claimType = value.claimType as Models.ClaimType.ClaimType;
        const claimValue = value.claimFields[0]?.value || '';

        if (
          !claimType.equals(Models.ClaimType.ClaimTypeOccupation) &&
          !claimType.equals(Models.ClaimType.ClaimTypeSkill) &&
          !claimType.equals(Models.ClaimType.ClaimTypeGeneric)
        ) {
          return getAccountUrl(claimType, claimValue);
        }
      }
      return undefined;
    }, [event, value]);

    const replyingToPointer = useMemo(() => {
      const { references } = event;
      const replyingToRef = references.find((ref) => ref.referenceType.eq(2));

      if (replyingToRef) {
        const replyingToPointer = Models.Pointer.fromProto(
          Protocol.Pointer.decode(replyingToRef.reference),
        );
        return replyingToPointer;
      }
      return undefined;
    }, [event]);

    const replyingToName = useUsernameCRDTQuery(replyingToPointer?.system);
    const replyingToURL = useEventLink(
      replyingToPointer?.system,
      replyingToPointer,
    );

    const imageUrl = useImageManifestDisplayURL(
      event.system,
      'content' in value ? value.image : undefined,
    );

    const pointer = useMemo(
      () => Models.signedEventToPointer(signedEvent),
      [signedEvent],
    );

    const mainUsername = useUsernameCRDTQuery(event.system);
    const mainAvatar = useAvatar(event.system);
    const mainKey = useTextPublicKey(event.system, 10);

    const mainDate = useDateFromUnixMS(event.unixMilliseconds);

    const mainURL = useEventLink(event.system, pointer);

    const mainAuthorURL = useSystemLink(event.system);

    const repostedPointer = useMemo(() => {
      const { references } = event;
      const repostRef = references.find((ref) => ref.referenceType.eq(4));
      
      if (repostRef) {
        return Models.Pointer.fromProto(
          Protocol.Pointer.decode(repostRef.reference)
        );
      }
      return undefined;
    }, [event]);
    
    const repostedPost = useRepostedPost(repostedPointer);

    const main: PurePostProps['main'] = useMemo(
      () => ({
        author: {
          name: mainUsername,
          avatarURL: mainAvatar,
          URL: mainAuthorURL,
          pubkey: mainKey,
        },
        replyingToName,
        replyingToURL,
        content: content || '',
        image: imageUrl,
        topic,
        publishedAt: mainDate,
        url: mainURL,
        type:
          'content' in value
            ? 'post'
            : 'claimType' in value
              ? 'claim'
              : 'vouch',
        repostedContent: repostedPost ? {
          content: repostedPost.content || '',
          author: {
            name: repostedPost.authorName || '',
            avatarURL: repostedPost.authorAvatar || '',
            URL: repostedPost.authorURL || '',
            pubkey: repostedPost.authorPubkey || '',
          },
        } : undefined,
      }),
      [
        mainUsername,
        mainAvatar,
        content,
        mainDate,
        mainURL,
        mainAuthorURL,
        mainKey,
        imageUrl,
        topic,
        replyingToName,
        replyingToURL,
        value,
        repostedPost,
      ],
    );

    const { stats } = usePostStatsWithLocalActions(pointer);

    return (
      <PurePost
        ref={ref}
        main={main}
        stats={stats}
        actions={actions}
        doesLink={doesLink}
        autoExpand={autoExpand}
        syncStatus={syncStatus}
        isMyProfile={isMyProfile}
      />
    );
  },
);
LoadedPost.displayName = 'LoadedPost';

const UnloadedPost = forwardRef<HTMLDivElement>((_, ref) => {
  return <PurePost ref={ref} main={undefined} />;
});
UnloadedPost.displayName = 'UnloadedPost';

export const Post = forwardRef<HTMLDivElement, PostProps>(
  ({ data, doesLink, autoExpand }, ref) => {
    const { processHandle } = useProcessHandleManager();
    const [ackCount, setAckCount] = useState<number | null>(null);
    const [servers, setServers] = useState<string[]>([]);
    const setupRef = useRef(false);
    const [repostDialogOpen, setRepostDialogOpen] = useState(false);

    useEffect(() => {
      if (
        !data ||
        !processHandle ||
        !Models.PublicKey.equal(processHandle.system(), data.event.system)
      ) {
        return;
      }

      if (setupRef.current) return;
      setupRef.current = true;

      const initialCount = processHandle.getEventAckCount(data.event);
      const initialServers = processHandle.getEventAckServers(data.event);
      setAckCount(initialCount);
      setServers(initialServers);

      const unsubscribe = processHandle.subscribeToEventAcks(data.event, () => {
        const newCount = processHandle.getEventAckCount(data.event);
        const newServers = processHandle.getEventAckServers(data.event);
        setAckCount(newCount);
        setServers(newServers);
      });

      return () => {
        setupRef.current = false;
        unsubscribe();
      };
    }, [data, processHandle]);

    if (!data) {
      return <UnloadedPost ref={ref} />;
    }

    const isMyPost =
      processHandle &&
      Models.PublicKey.equal(processHandle.system(), data.event.system);

    let status;
    if (!navigator.onLine) {
      status = { state: 'offline' as const, acknowledgedServers: 0 };
    } else if (isMyPost) {
      if (ackCount === null) {
        status = { state: 'syncing' as const, acknowledgedServers: 0 };
      } else if (ackCount === 0) {
        status = { state: 'syncing' as const, acknowledgedServers: 0 };
      } else {
        status = {
          state: 'acknowledged' as const,
          acknowledgedServers: ackCount,
          servers,
        };
      }
    }

    const handleRepost = () => {
      setRepostDialogOpen(true);
    };

    const pointer = Models.signedEventToPointer(data.signedEvent);
    const { actions } = usePostStatsWithLocalActions(pointer);

    // Update actions to include repost
    const enhancedActions = useMemo(() => {
      if (!actions) return undefined;
      return {
        ...actions,
        repost: handleRepost,
      };
    }, [actions, handleRepost]);

    return (
      <>
        <LoadedPost
          ref={ref}
          data={data}
          doesLink={doesLink}
          autoExpand={autoExpand}
          syncStatus={isMyPost ? status : undefined}
          isMyProfile={isMyPost}
          actions={enhancedActions}
        />
        <RepostDialog
          open={repostDialogOpen}
          setOpen={setRepostDialogOpen}
          originalPost={data}
          onSubmit={(content, attachment) => {
            if (processHandle && data) {
              // First convert signedEvent to a pointer
              const pointer = Models.signedEventToPointer(data.signedEvent);
              
              // Create the reference using the pointer
              const reference: Protocol.Reference = {
                referenceType: Long.fromNumber(4),
                reference: Protocol.Pointer.encode({
                  system: pointer.system,
                  process: pointer.process,
                  logicalClock: pointer.logicalClock,
                  eventDigest: pointer.eventDigest,
                }).finish(),
              };
              
              // Call post with correct parameter order
              processHandle.post(
                content,
                attachment ? undefined : undefined,
                reference
              );
            }
          }}
        />
      </>
    );
  },
);

Post.displayName = 'Post';
