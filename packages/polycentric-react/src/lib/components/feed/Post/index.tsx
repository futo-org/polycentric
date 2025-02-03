import { Models, Protocol, Util } from '@polycentric/polycentric-core';
import { forwardRef, useMemo } from 'react';
import { FeedItem } from '../../../hooks/feedHooks';
import {
    useAvatar,
    useImageManifestDisplayURL,
} from '../../../hooks/imageHooks';
import {
    useDateFromUnixMS,
    useEventLink,
    useSystemLink,
    useTextPublicKey,
    useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { usePostStatsWithLocalActions } from '../../../hooks/statsHooks';
import { getAccountUrl } from '../../../util/protocol-utils';
import { PurePost, PurePostProps } from './PurePost';

interface PostProps {
    data: FeedItem | undefined;
    doesLink?: boolean;
    autoExpand?: boolean;
}

interface LoadedPostProps {
    data: FeedItem;
    doesLink?: boolean;
    autoExpand?: boolean;
}

const LoadedPost = forwardRef<HTMLDivElement, LoadedPostProps>(
    ({ data, doesLink, autoExpand }, ref) => {
        const { value, event, signedEvent } = data;

        const content = useMemo(() => {
            if ('content' in value) {
                return value.content;
            } else if ('claimType' in value) {
                const claimType = value.claimType as Models.ClaimType.ClaimType;
                const claimValue = value.claimFields[0]?.value || '';

                if (claimType.equals(Models.ClaimType.ClaimTypeOccupation)) {
                    return `Claims they work at ${value.claimFields[0].value} as ${value.claimFields[1].value} in ${value.claimFields[2].value}.`;
                } else if (claimType.equals(Models.ClaimType.ClaimTypeSkill)) {
                    return `Claimed skill: ${claimValue}`;
                } else if (
                    claimType.equals(Models.ClaimType.ClaimTypeGeneric)
                ) {
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
                const topicRef = references.find((ref) =>
                    ref.referenceType.eq(3),
                );
                return topicRef
                    ? Util.decodeText(topicRef.reference)
                    : undefined;
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
        return data ? (
            <LoadedPost
                ref={ref}
                data={data}
                doesLink={doesLink}
                autoExpand={autoExpand}
            />
        ) : (
            <UnloadedPost ref={ref} />
        );
    },
);

Post.displayName = 'Post';
