import { CancelContext, Models, Util } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProcessHandleManager } from './processHandleManagerHooks';
import { useQueryOpinion, useQueryPointerReferences } from './queryHooks';

// Declare explicitly so they don't cause a useEffect rerender
const postStatsRequestEvents = {
    fromType: Models.ContentType.ContentTypePost,
    countLwwElementReferences: [],
    countReferences: [],
};

const postStatLwwElementReferences = [
    {
        fromType: Models.ContentType.ContentTypeOpinion,
        value: Models.Opinion.OpinionLike,
    },
    {
        fromType: Models.ContentType.ContentTypeOpinion,
        value: Models.Opinion.OpinionDislike,
    },
];

const postStatReferences = [
    {
        fromType: Models.ContentType.ContentTypePost,
    },
];

export const usePostStats = (pointer: Models.Pointer.Pointer) => {
    const out = useQueryPointerReferences(
        pointer,
        undefined,
        postStatsRequestEvents,
        postStatLwwElementReferences,
        postStatReferences,
    );

    const counts = useMemo(() => {
        if (out === undefined)
            return {
                likes: undefined,
                dislikes: undefined,
                comments: undefined,
            };

        let likes = 0;
        let dislikes = 0;
        let comments = 0;

        out?.forEach((response) => {
            likes += response.counts[0].toNumber();
            dislikes += response.counts[1].toNumber();
            comments += response.counts[2].toNumber();
        });

        return {
            likes,
            dislikes,
            comments,
        };
    }, [out]);

    return counts;
};

export const usePostStatsWithLocalActions = (
    pointer: Models.Pointer.Pointer,
) => {
    const { processHandle } = useProcessHandleManager();

    const reference = useMemo(() => {
        return Models.pointerToReference(pointer);
    }, [pointer]);

    const [opinion, setOpinion] = useState<'liked' | 'neutral' | 'disliked'>(
        'neutral',
    );
    const [locallyNeutral, setLocallyNeutral] = useState<boolean>(false);

    const refreshOpinion = useCallback(
        (cancelContext?: CancelContext.CancelContext) => {
            processHandle
                .store()
                .opinionIndex.get(processHandle.system(), reference)
                .then((result) => {
                    if (
                        cancelContext !== undefined &&
                        cancelContext.cancelled()
                    ) {
                        return;
                    }
                    const opinion = Util.buffersEqual(
                        result,
                        Models.Opinion.OpinionLike,
                    )
                        ? 'liked'
                        : Util.buffersEqual(
                                result,
                                Models.Opinion.OpinionDislike,
                            )
                          ? 'disliked'
                          : 'neutral';
                    setOpinion(opinion);
                });
        },
        [processHandle, reference],
    );

    // Initial load
    useEffect(() => {
        const cancelContext = new CancelContext.CancelContext();
        refreshOpinion(cancelContext);

        return () => {
            cancelContext.cancel();
        };
    }, [refreshOpinion]);

    const like = useCallback(() => {
        processHandle
            .opinion(reference, Models.Opinion.OpinionLike)
            .then(() => {
                refreshOpinion();
                setLocallyNeutral(false);
            });
    }, [reference, processHandle, refreshOpinion]);

    const neutralopinion = useCallback(() => {
        processHandle
            .opinion(reference, Models.Opinion.OpinionNeutral)
            .then(() => {
                refreshOpinion();
                setLocallyNeutral(true);
            });
    }, [reference, processHandle, refreshOpinion]);

    const dislike = useCallback(() => {
        processHandle
            .opinion(reference, Models.Opinion.OpinionDislike)
            .then(() => {
                refreshOpinion();
                setLocallyNeutral(false);
            });
    }, [reference, processHandle, refreshOpinion]);

    const stats = usePostStats(pointer);
    const opinionOnMount = useQueryOpinion(processHandle.system(), reference);
    const likedOnMount = useMemo(() => {
        if (opinionOnMount === undefined) {
            return undefined;
        }
        return Util.buffersEqual(opinionOnMount, Models.Opinion.OpinionLike);
    }, [opinionOnMount]);

    const locallyModifiedLikes = useMemo(() => {
        let likes = stats.likes;
        if (stats.likes === 0 && opinion === 'liked') {
            likes = stats.likes + 1;
        } else if (
            opinion === 'liked' &&
            likedOnMount === false &&
            stats.likes
        ) {
            likes = stats.likes + 1;
        } else if (locallyNeutral && stats.likes && stats.likes > 0) {
            likes = stats.likes - 1;
        }

        return likes;
    }, [stats, opinion, likedOnMount, locallyNeutral]);

    const locallyModifiedDislikes = useMemo(() => {
        let dislikes = stats.dislikes;
        if (stats.dislikes === 0 && opinion === 'disliked') {
            dislikes = stats.dislikes + 1;
        } else if (
            opinion === 'disliked' &&
            likedOnMount === false &&
            stats.dislikes
        ) {
            dislikes = stats.dislikes + 1;
        } else if (locallyNeutral && stats.dislikes && stats.dislikes > 0) {
            dislikes = stats.dislikes - 1;
        }

        return dislikes;
    }, [stats, opinion, likedOnMount, locallyNeutral]);

    const comment = useCallback(
        async (text: string) => {
            const reference = Models.pointerToReference(pointer);
            await processHandle.post(text, undefined, reference);
            return true;
        },
        [pointer, processHandle],
    );

    const actions = useMemo(() => {
        return {
            like,
            neutralopinion,
            dislike,
            comment,
            repost: () => {},
        };
    }, [like, dislike, comment, neutralopinion]);

    const locallyModifiedStats = useMemo(() => {
        return {
            opinion,
            likes: locallyModifiedLikes,
            dislikes: locallyModifiedDislikes,
            comments: stats.comments,
        };
    }, [
        opinion,
        locallyModifiedLikes,
        locallyModifiedDislikes,
        stats.comments,
    ]);

    return {
        stats: locallyModifiedStats,
        actions,
    };
};
