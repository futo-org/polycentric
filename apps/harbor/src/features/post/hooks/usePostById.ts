import { useMemo } from 'react';
import {
  COLLECTION,
  type FetchMode,
  Query,
  v2,
} from '@polycentric/react-native';
import {
  decodeV2PostBundle,
  type PostData,
} from '@/src/common/lib/polycentric-hooks';
import { getKeyFingerprint } from '@/src/common/lib/polycentric-hooks/helpers';
import { useQuery } from '@/src/common/query/hooks/useQuery';

/**
 * Load a single post by its (identity, sequence) route params.
 *
 * Subscribes to `core.getEvent`, which checks the local store first
 * and falls back to a `ListEvents` query with `sequenceGt = seq - 1`
 * / `sequenceLt = seq + 1` to pin the network query to exactly one
 * sequence. `keyFingerprint` is used only to verify the returned
 * bundle matches the expected signer; the rust side picks the first
 * local-store hit at that sequence.
 */
export function usePostById(
  identityId: string | undefined,
  keyFingerprint: string | undefined,
  sequence: bigint | undefined,
  options?: { fetchMode?: FetchMode },
): { post: PostData | null; isLoading: boolean; error: Error | null } {
  const enabled = !!identityId && sequence != null && !!keyFingerprint;

  const query = useQuery(
    [
      'event',
      String(COLLECTION.FEED),
      identityId ?? '',
      keyFingerprint ?? '',
      sequence?.toString() ?? '',
    ],
    new Query.GetEvent({
      identity: identityId ?? '',
      collection: COLLECTION.FEED,
      sequence: sequence ?? 0n,
      signerKeyPrefix: keyFingerprint,
    }),
    options?.fetchMode ? { fetchMode: options.fetchMode } : undefined,
    enabled,
  );

  const post = useMemo<PostData | null>(() => {
    if (!enabled) return null;
    if (!query.data || query.data.byteLength === 0) return null;
    try {
      const bundle = v2.EventBundle.fromBinary(new Uint8Array(query.data));
      if (!bundle.signedEvent) return null;
      const ev = v2.Event.fromBinary(bundle.signedEvent.eventBytes);
      // Verify the signer fingerprint matches the URL so a sequence
      // collision across signers doesn't render the wrong post.
      if (
        getKeyFingerprint(ev.key?.signedBy) !== keyFingerprint ||
        ev.key?.sequence !== sequence
      ) {
        return null;
      }
      return decodeV2PostBundle(bundle);
    } catch {
      return null;
    }
  }, [enabled, query.data, keyFingerprint, sequence]);

  return {
    post,
    isLoading: query.isLoading,
    error: query.error ? new Error(query.error) : null,
  };
}
