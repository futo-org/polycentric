import { CancelContext, Models, Util } from '@polycentric/polycentric-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { publishImageBlob } from '../util/imageProcessing';
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

export function usePostStatsWithLocalActions(pointer: Models.Pointer.Pointer) {
  const { processHandle } = useProcessHandleManager();

  const reference = useMemo(() => {
    return Models.pointerToReference(pointer);
  }, [pointer]);

  const [opinion, setOpinion] = useState<'liked' | 'neutral' | 'disliked'>(
    'neutral',
  );

  const refreshOpinion = useCallback(
    (cancelContext?: CancelContext.CancelContext) => {
      processHandle
        .store()
        .indexOpinion.get(processHandle.system(), reference)
        .then((result) => {
          if (cancelContext !== undefined && cancelContext.cancelled()) {
            return;
          }
          const opinion = Util.buffersEqual(result, Models.Opinion.OpinionLike)
            ? 'liked'
            : Util.buffersEqual(result, Models.Opinion.OpinionDislike)
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
    // Update opinion
    setOpinion('liked');

    // Call API to save the like
    processHandle.opinion(reference, Models.Opinion.OpinionLike).then(() => {
      refreshOpinion();
    });
  }, [reference, processHandle, refreshOpinion]);

  const neutralopinion = useCallback(() => {
    processHandle.opinion(reference, Models.Opinion.OpinionNeutral).then(() => {
      refreshOpinion();
    });
  }, [reference, processHandle, refreshOpinion]);

  const dislike = useCallback(() => {
    // Update opinion
    setOpinion('disliked');

    // Call API to save the dislike
    processHandle.opinion(reference, Models.Opinion.OpinionDislike).then(() => {
      refreshOpinion();
    });
  }, [reference, processHandle, refreshOpinion]);

  const deletePost = useMemo(() => {
    const isUserOwner = Models.PublicKey.equal(
      processHandle.system(),
      pointer.system,
    );

    if (!isUserOwner) {
      return undefined;
    }

    return async () => {
      return await processHandle.delete(pointer.process, pointer.logicalClock);
    };
  }, [pointer, processHandle]);

  const stats = usePostStats(pointer);
  const opinionOnMount = useQueryOpinion(processHandle.system(), reference);

  const locallyModifiedStats = useMemo(() => {
    // Start with base stats from the server
    let likes = stats.likes || 0;
    let dislikes = stats.dislikes || 0;

    // Check what's in the backend for this user
    const hasLikeInBackend =
      opinionOnMount &&
      Util.buffersEqual(opinionOnMount, Models.Opinion.OpinionLike);
    const hasDislikeInBackend =
      opinionOnMount &&
      Util.buffersEqual(opinionOnMount, Models.Opinion.OpinionDislike);

    // Get the current opinion state
    const currentLiked = opinion === 'liked';
    const currentDisliked = opinion === 'disliked';

    // Compare and adjust counts

    // If we liked in backend but no longer like, remove our like
    if (hasLikeInBackend && !currentLiked) {
      likes = Math.max(0, likes - 1);
    }

    // If we disliked in backend but no longer dislike, remove our dislike
    if (hasDislikeInBackend && !currentDisliked) {
      dislikes = Math.max(0, dislikes - 1);
    }

    // If we now like but didn't before, add our like
    if (currentLiked && !hasLikeInBackend) {
      likes += 1;
    }

    // If we now dislike but didn't before, add our dislike
    if (currentDisliked && !hasDislikeInBackend) {
      dislikes += 1;
    }

    return {
      opinion,
      likes: Math.max(0, likes),
      dislikes: Math.max(0, dislikes),
      comments: stats.comments,
    };
  }, [opinion, stats, opinionOnMount]);

  const comment = useCallback(
    async (text: string, upload?: File[]) => {
      const reference = Models.pointerToReference(pointer);

      if (upload) {
        const imageManifest = [];

        for (const u of upload) {
          imageManifest.push(await publishImageBlob(u, processHandle));
        }
        
        await processHandle.post(text, imageManifest, reference);
      } else {
        await processHandle.post(text, undefined, reference);
      }
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
      delete: deletePost,
    };
  }, [like, dislike, comment, neutralopinion, deletePost]);

  return {
    actions,
    stats: locallyModifiedStats,
  };
}
