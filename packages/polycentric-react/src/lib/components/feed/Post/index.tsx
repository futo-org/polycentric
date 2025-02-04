import { Models, Protocol, Util } from '@polycentric/polycentric-core';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
    useAvatar,
    useImageManifestDisplayURL,
} from '../../../hooks/imageHooks';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import {
    ParsedEvent,
    useDateFromUnixMS,
    useEventLink,
    useSystemLink,
    useTextPublicKey,
    useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { usePostStatsWithLocalActions } from '../../../hooks/statsHooks';
import { PurePost, PurePostProps } from './PurePost';

interface PostProps {
    data: ParsedEvent<Protocol.Post> | undefined;
    doesLink?: boolean;
    autoExpand?: boolean;
    isNewPost?: boolean;
}

interface LoadedPostProps {
    data: ParsedEvent<Protocol.Post>;
    doesLink?: boolean;
    autoExpand?: boolean;
    syncStatus?: {
        state: 'offline' | 'syncing' | 'acknowledged';
        acknowledgedServers: number;
        servers?: string[];
    };
    isMyProfile: boolean;
}

const LoadedPost = forwardRef<HTMLDivElement, LoadedPostProps>(
    ({ data, doesLink, autoExpand, syncStatus, isMyProfile }, ref) => {
        const { value, event, signedEvent } = data;
        const { content, image } = value;

        const topic = useMemo(() => {
            const { references } = event;
            const topicRef = references.find((ref) => ref.referenceType.eq(3));

            if (topicRef) {
                return Util.decodeText(topicRef.reference);
            }
            return undefined;
        }, [event]);

        const replyingToPointer = useMemo(() => {
            const { references } = event;
            const replyingToRef = references.find((ref) =>
                ref.referenceType.eq(2),
            );

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

        const imageUrl = useImageManifestDisplayURL(event.system, image);

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
                content: content ?? '',
                image: imageUrl,
                topic,
                publishedAt: mainDate,
                url: mainURL,
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
            ],
        );

        const { actions, stats } = usePostStatsWithLocalActions(pointer);

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

        useEffect(() => {
            if (
                !data ||
                !processHandle ||
                !Models.PublicKey.equal(
                    processHandle.system(),
                    data.event.system,
                )
            ) {
                return;
            }

            if (setupRef.current) return;
            setupRef.current = true;

            const initialCount = processHandle.getEventAckCount(data.event);
            const initialServers = processHandle.getEventAckServers(data.event);
            setAckCount(initialCount);
            setServers(initialServers);

            const unsubscribe = processHandle.subscribeToEventAcks(
                data.event,
                () => {
                    const newCount = processHandle.getEventAckCount(data.event);
                    const newServers = processHandle.getEventAckServers(
                        data.event,
                    );
                    setAckCount(newCount);
                    setServers(newServers);
                },
            );

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

        return (
            <LoadedPost
                ref={ref}
                data={data}
                doesLink={doesLink}
                autoExpand={autoExpand}
                syncStatus={isMyPost ? status : undefined}
                isMyProfile={isMyPost}
            />
        );
    },
);

Post.displayName = 'Post';
