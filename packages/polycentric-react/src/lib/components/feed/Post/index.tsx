/**
 * @fileoverview Post display component with sync status and moderation support.
 */

import { Models, Protocol, Util } from '@polycentric/polycentric-core';
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
  useQueryManager,
  useSystemLink,
  useTextPublicKey,
  useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { usePostStatsWithLocalActions } from '../../../hooks/statsHooks';
import { getAccountUrl } from '../../util/linkify/utils';
import { PurePost } from './PurePost';

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
  moderationTags?: Array<{ name: string; level: number }>;
}

// Post component with loaded data and moderation tags
const LoadedPost = forwardRef<HTMLDivElement, LoadedPostProps>(
  (
    { data, doesLink, autoExpand, syncStatus, isMyProfile, moderationTags },
    ref,
  ) => {
    const { value, event, signedEvent } = data;

    const [vouchedClaim, setVouchedClaim] = useState<{
      type: Models.ClaimType.ClaimType;
      value: string;
      system: Models.PublicKey.PublicKey;
    } | null>(null);
    const queryManager = useQueryManager();
    const [isDeleting, setIsDeleting] = useState(false);

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

    const replyingToPointer = useMemo(() => {
      const { references } = event;
      const replyingToRef = references.find((ref) => ref.referenceType.eq(2));
      if (replyingToRef) {
        return Models.Pointer.fromProto(
          Protocol.Pointer.decode(replyingToRef.reference),
        );
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

    const { actions, stats } = usePostStatsWithLocalActions(pointer);

    const enhancedActions = useMemo(() => {
      if (!actions) return undefined;

      return {
        ...actions,
        delete: actions.delete
          ? () => {
              setIsDeleting(true);
              actions.delete?.();
            }
          : undefined,
        isDeleting,
      };
    }, [actions, isDeleting]);

    useEffect(() => {
      if (
        event.contentType.eq(Models.ContentType.ContentTypeVouch) &&
        event.references.length > 0 &&
        queryManager
      ) {
        try {
          const vouchedRef = event.references[0];
          const pointer = Models.Pointer.fromProto(
            Protocol.Pointer.decode(vouchedRef.reference),
          );

          queryManager.queryEvent.query(
            pointer.system,
            pointer.process,
            pointer.logicalClock,
            (signedEvent) => {
              if (!signedEvent) return;

              try {
                const claimEvent = Models.Event.fromBuffer(signedEvent.event);
                if (
                  claimEvent.contentType.eq(Models.ContentType.ContentTypeClaim)
                ) {
                  const claim = Protocol.Claim.decode(claimEvent.content);
                  setVouchedClaim({
                    type: claim.claimType as Models.ClaimType.ClaimType,
                    value: claim.claimFields[0]?.value || '',
                    system: pointer.system,
                  });
                }
              } catch (error) {
                console.error('Failed to decode vouched claim:', error);
              }
            },
          );
        } catch (error) {
          console.error('Failed to process vouch reference:', error);
        }
      }
    }, [event, queryManager]);

    const isDeleted = useMemo(() => {
      if (event.contentType.eq(Models.ContentType.ContentTypeVouch)) {
        return false;
      }
      if ('claimType' in value) {
        const claimType = value.claimType as Models.ClaimType.ClaimType;
        return claimType.low === 0 && claimType.high === 0;
      }
      return false;
    }, [value, event]);

    const content = useMemo(() => {
      if (event.contentType.eq(Models.ContentType.ContentTypeVouch)) {
        return '';
      }

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
      }

      return '';
    }, [value, event]);

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
      } else if (
        event.contentType.eq(Models.ContentType.ContentTypeVouch) &&
        vouchedClaim
      ) {
        if (
          !vouchedClaim.type.equals(Models.ClaimType.ClaimTypeOccupation) &&
          !vouchedClaim.type.equals(Models.ClaimType.ClaimTypeSkill) &&
          !vouchedClaim.type.equals(Models.ClaimType.ClaimTypeGeneric)
        ) {
          return getAccountUrl(vouchedClaim.type, vouchedClaim.value);
        }
      }
      return undefined;
    }, [event, value, vouchedClaim]);

    const main = useMemo(
      () => ({
        author: {
          name: mainUsername,
          avatarURL: mainAvatar || '',
          URL: mainAuthorURL,
          pubkey: mainKey || '',
        },
        replyingToName,
        replyingToURL,
        content: content || '',
        image: imageUrl,
        topic,
        publishedAt: mainDate,
        url: mainURL,
        type: (event.contentType.eq(Models.ContentType.ContentTypeVouch)
          ? 'vouch'
          : 'content' in value
            ? 'post'
            : 'claim') as 'vouch' | 'post' | 'claim',
        vouchedClaim: vouchedClaim || undefined,
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
        event,
        vouchedClaim,
      ],
    );

    if (isDeleted) {
      return (
        <div
          ref={ref}
          className="p-4 border-b border-gray-100 text-gray-500 text-center italic"
        >
          Post could not be found
        </div>
      );
    }

    return (
      <PurePost
        ref={ref}
        main={main}
        stats={stats}
        actions={enhancedActions}
        doesLink={doesLink}
        autoExpand={autoExpand}
        syncStatus={syncStatus}
        isMyProfile={isMyProfile}
        moderationTags={moderationTags}
      />
    );
  },
);
LoadedPost.displayName = 'LoadedPost';

// Placeholder for unloaded posts
const UnloadedPost = forwardRef<HTMLDivElement>((_, ref) => {
  return <PurePost ref={ref} main={undefined} />;
});
UnloadedPost.displayName = 'UnloadedPost';

// Main post component with sync status tracking
export const Post = forwardRef<HTMLDivElement, PostProps>(
  ({ data, doesLink, autoExpand }, ref) => {
    const { processHandle } = useProcessHandleManager();
    const [ackCount, setAckCount] = useState<number | null>(null);
    const [servers, setServers] = useState<string[]>([]);
    const [moderationTags, setModerationTags] = useState<
      Array<{ name: string; level: number }>
    >([]);

    const hasSeenExternalServersRef = useRef(false);

    useEffect(() => {
      if (
        !data ||
        !processHandle ||
        !Models.PublicKey.equal(processHandle.system(), data.event.system)
      ) {
        return;
      }

      const initialCount = processHandle.getEventAckCount(data.event);
      const initialServers = processHandle.getEventAckServers(data.event);

      const hasExternalServers = initialServers.some((s) => s !== 'local');
      if (hasExternalServers) {
        hasSeenExternalServersRef.current = true;
      }

      setAckCount(initialCount);
      setServers(initialServers);

      processHandle
        .store()
        .indexEvents.getEventAcks()
        .then((rawAcks) => {
          // Look for our stable keys first
          const logicalClockStr = data.event.logicalClock.toString();
          const stableKey = `event_${logicalClockStr}_stable`;

          if (rawAcks[stableKey]) {
            const stableServers = rawAcks[stableKey];
            if (stableServers.includes('http://localhost:8081')) {
              hasSeenExternalServersRef.current = true;
              setServers(['local', 'http://localhost:8081']);
              setAckCount(2);
              return;
            }
          }

          let additionalServers: string[] = [];

          for (const [key, serverList] of Object.entries(rawAcks)) {
            if (key.includes(logicalClockStr)) {
              additionalServers = [...additionalServers, ...serverList];
            }
          }

          if (additionalServers.length > 0) {
            const allServers = [
              ...new Set([...initialServers, ...additionalServers]),
            ];
            if (allServers.length > initialServers.length) {
              if (allServers.some((s) => s !== 'local')) {
                hasSeenExternalServersRef.current = true;
              }
              setServers(allServers);
              setAckCount(allServers.length);
            }
          }
        });

      const unsubscribe = processHandle.subscribeToEventAcks(
        data.event,
        (serverId) => {
          if (serverId === 'local' && hasSeenExternalServersRef.current) {
            return;
          }

          if (serverId !== 'local') {
            hasSeenExternalServersRef.current = true;
          }

          const newServers = processHandle.getEventAckServers(data.event);

          setServers((prevServers) => {
            const combinedServers = [
              ...new Set([...prevServers, ...newServers]),
            ];
            setAckCount(combinedServers.length);
            return combinedServers;
          });
        },
      );

      return () => {
        unsubscribe();
      };
    }, [data, processHandle]);

    useEffect(() => {
      if (!data || !data.signedEvent) return;

      if (data.signedEvent.moderationTags) {
        setModerationTags(
          data.signedEvent.moderationTags.map((tag) => ({
            name: tag.name,
            level: tag.level,
          })),
        );
      }
    }, [data]);

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
          acknowledgedServers: servers.length,
          servers: servers,
        };
      }
    }

    return (
      <LoadedPost
        ref={ref}
        data={data}
        doesLink={doesLink}
        autoExpand={autoExpand}
        syncStatus={isMyPost ? status : undefined}
        isMyProfile={isMyPost}
        moderationTags={moderationTags}
      />
    );
  },
);

Post.displayName = 'Post';
