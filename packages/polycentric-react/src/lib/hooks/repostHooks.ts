import { Models, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';
import { useEffect, useState } from 'react';
import { useAvatar } from './imageHooks';
import { useProcessHandleManager } from './processHandleManagerHooks';
import {
  useEventLink,
  useSystemLink,
  useTextPublicKey,
  useUsernameCRDTQuery,
} from './queryHooks';

export function useRepostedPost(pointer?: Models.Pointer.Pointer) {
  const [repostData, setRepostData] = useState<{
    content: string;
    authorName: string;
    authorAvatar: string;
    authorURL: string;
    authorPubkey: string;
    postURL: string;
  } | null>(null);

  const { processHandle } = useProcessHandleManager();

  // Extract system from pointer safely
  const system = pointer?.system;

  // Create a sentinel PublicKey object to use when system is undefined
  const [sentinelKey] = useState(() => {
    return Models.PublicKey.fromProto({
      keyType: Long.fromNumber(1),
      key: new Uint8Array(32),
    });
  });

  // Use a state to track whether the system is valid to ensure consistent rendering
  const [isValidSystem, setIsValidSystem] = useState(!!system);
  useEffect(() => {
    setIsValidSystem(!!system);
  }, [system]);

  // Always call hooks with either the real system or our sentinel key
  // The sentinel key will never actually be used for queries
  // We have to do this to satisfy the linter
  const authorNameResult = useUsernameCRDTQuery(system || sentinelKey!);
  const authorAvatarResult = useAvatar(system || sentinelKey!);
  const authorURLResult = useSystemLink(system || sentinelKey!);
  const authorPubkeyResult = useTextPublicKey(system || sentinelKey!, 10);
  const postURLResult = useEventLink(system || sentinelKey!, pointer);

  useEffect(() => {
    if (!pointer || !system || !processHandle) {
      setRepostData(null);
      return;
    }

    let isCancelled = false;

    const loadRepostedContent = async () => {
      try {
        // Get the signed event
        const signedEvent = await processHandle
          .store()
          .indexEvents.getSignedEvent(
            pointer.system,
            pointer.process,
            pointer.logicalClock,
          );

        if (isCancelled || !signedEvent) return;

        const eventData = Models.Event.fromBuffer(signedEvent.event);

        if (!eventData.contentType.equals(Models.ContentType.ContentTypePost)) {
          return;
        }

        const post = Protocol.Post.decode(eventData.content);
        const content = post.content || '';

        // Only use the hook results if the system is valid
        const finalAuthorName = isValidSystem ? authorNameResult : '';
        const finalAuthorAvatar = isValidSystem ? authorAvatarResult : '';
        const finalAuthorURL = isValidSystem ? authorURLResult : '';
        const finalAuthorPubkey = isValidSystem ? authorPubkeyResult : '';
        const finalPostURL = isValidSystem ? postURLResult : '';

        // Update all data with real values
        setRepostData({
          content,
          authorName:
            finalAuthorName ||
            `User ${finalAuthorPubkey?.substring(0, 5) || ''}`,
          authorAvatar: finalAuthorAvatar || '',
          authorURL: finalAuthorURL || '',
          authorPubkey: finalAuthorPubkey || '',
          postURL: finalPostURL || '',
        });
      } catch (err) {
        console.error('Error loading reposted content:', err);
      }
    };

    loadRepostedContent();

    return () => {
      isCancelled = true;
    };
  }, [
    pointer,
    system,
    processHandle,
    authorNameResult,
    authorAvatarResult,
    authorURLResult,
    authorPubkeyResult,
    postURLResult,
    isValidSystem,
  ]);

  return repostData;
}
