import { Models, Protocol, Util } from '@polycentric/polycentric-core';
import { forwardRef, useEffect, useMemo } from 'react';
import {
    useAvatar,
    useImageManifestDisplayURL,
} from '../../../hooks/imageHooks';
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

export interface PostProps {
    data: ParsedEvent<Protocol.Post> | undefined;
    doesLink?: boolean;
    autoExpand?: boolean;
    onBasicsLoaded?: () => void;
    showPlaceholders?: boolean;
}

type LoadedPostProps = PostProps & {
    data: ParsedEvent<Protocol.Post>;
};

const LoadedPost = forwardRef<HTMLDivElement, LoadedPostProps>(
    ({ data, doesLink, autoExpand, onBasicsLoaded, showPlaceholders }, ref) => {
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

        useEffect(() => {
            const basicsLoaded =
                mainUsername !== undefined && mainAvatar !== undefined;

            if (basicsLoaded) {
                onBasicsLoaded?.();
            }
        }, [mainUsername, mainAvatar, onBasicsLoaded]);

        return (
            <PurePost
                ref={ref}
                main={main}
                stats={stats}
                actions={actions}
                doesLink={doesLink}
                autoExpand={autoExpand}
                showPlaceholders={showPlaceholders}
            />
        );
    },
);
LoadedPost.displayName = 'LoadedPost';

const UnloadedPost = forwardRef<HTMLDivElement>((_, ref) => {
    return <PurePost ref={ref} main={undefined} showPlaceholders={true} />;
});
UnloadedPost.displayName = 'UnloadedPost';

export const Post = forwardRef<HTMLDivElement, PostProps>((props, ref) => {
    const { data } = props;
    return data ? (
        <LoadedPost ref={ref} {...props} data={data} />
    ) : (
        <UnloadedPost ref={ref} />
    );
});

Post.displayName = 'Post';
