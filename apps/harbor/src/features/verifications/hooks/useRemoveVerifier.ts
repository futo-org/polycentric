import {
  type DecodedBundle,
  decodeBundle,
  eventKeyId,
  usePolycentric,
} from '@/src/common/lib/polycentric-hooks';
import { invalidateQuery } from '@/src/common/query/hooks/useQuery';
import { COLLECTION, SyncStrategy, v2 } from '@polycentric/react-native';
import { useState } from 'react';
import type { DecodedClaim } from './useClaimById';

type Client = ReturnType<typeof usePolycentric>;

// Remove a requested verifier from the current identity's own claim.
export default function useRemoveVerifier(claim: DecodedClaim) {
  const client = usePolycentric();
  const [isPending, setPending] = useState(false);

  return {
    isPending,
    submit: async (verifier: string): Promise<void> => {
      if (isPending) {
        throw 'Already pending';
      }
      setPending(true);
      try {
        await removeVerifier(client, claim.id, verifier);

        invalidateQuery(client, ['verification-targets', claim.id]);
        invalidateQuery(client, ['claims-list', claim.identity]);
        invalidateQuery(client, ['targeted-verification-claims', verifier]);
      } finally {
        setPending(false);
      }
    },
  };
}

/**
 * Tombstone every VerificationTarget the active identity wrote for `claimId`
 * that names `verifier`. Pushed to servers best-effort.
 */
export async function removeVerifier(
  client: Client,
  claimId: string,
  verifier: string,
): Promise<void> {
  const self = client.activeIdentityKey;
  if (!self) return;

  const targets = client
    .listValidEvents(self, COLLECTION.VERIFICATIONS)
    .map((bundle) => decodeBundle(bundle, 'verificationTarget'))
    .filter(
      (entry): entry is DecodedBundle<'verificationTarget'> =>
        entry !== null &&
        entry.event.key !== undefined &&
        entry.content.claimEventKey !== undefined &&
        eventKeyId(entry.content.claimEventKey) === claimId &&
        entry.content.targetIdentities.includes(verifier),
    );
  if (targets.length === 0) return;

  // Delete tombstones the whole target event. Harbor writes one identity per
  // target for non-platform claims, so this removes exactly one verifier
  for (const { event } of targets) {
    const deleteContent = v2.Content.create({
      contentBody: { oneofKind: 'delete', delete: { eventKey: event.key } },
    });
    await client.contentManager.save(deleteContent);
    const deleteEvent = await client.buildEvent(
      deleteContent,
      COLLECTION.VERIFICATIONS,
    );
    const signedDelete = await client.signEvent(deleteEvent);
    await client.commitEvent(signedDelete, deleteContent);
  }

  try {
    await client.sync(SyncStrategy.PARTIAL_PUSH);
  } catch (e) {
    console.warn('Failed to push verifier removal to servers:', e);
  }
}
