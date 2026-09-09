// The barrel pulls in native uniffi init at import time — expose just what
// the hook needs.
jest.mock('@polycentric/react-native', () => ({
  v2: jest.requireActual('../../../../../../packages/js-core/src/proto/v2'),
  COLLECTION: { VERIFICATIONS: 8 },
  SyncStrategy: { PARTIAL_PUSH: 'partial-push' },
}));

// ESM-only; jest-expo doesn't transform it. The digest content is irrelevant.
jest.mock('@noble/hashes/sha2.js', () => ({
  sha256: () => new Uint8Array(32),
}));

const mockClient = {
  activeIdentityKey: 'me' as string | null,
  listValidEvents: jest.fn((): unknown[] => []),
  contentManager: { save: jest.fn(async () => undefined) },
  buildEvent: jest.fn(async () => ({})),
  signEvent: jest.fn(async (event: unknown) => ({ event })),
  commitEvent: jest.fn(
    async (_signed: unknown, _content: unknown) => undefined,
  ),
  sync: jest.fn(async () => undefined),
};

jest.mock('@/src/common/lib/polycentric-hooks', () => {
  const helpers = jest.requireActual(
    '@/src/common/lib/polycentric-hooks/helpers',
  );
  return {
    usePolycentric: () => mockClient,
    decodeBundle: helpers.decodeBundle,
    eventKeyId: helpers.eventKeyId,
  };
});

jest.mock('@/src/common/query/hooks/useQuery', () => ({
  invalidateQuery: jest.fn(),
}));

import { invalidateQuery } from '@/src/common/query/hooks/useQuery';
import type { v2 as V2 } from '@polycentric/react-native';
import * as React from 'react';
import { act } from 'react';
import TestRenderer from 'react-test-renderer';
import type { DecodedClaim } from './useClaimById';
import useRemoveVerifier, { removeVerifier } from './useRemoveVerifier';

const { v2 } = jest.requireMock('@polycentric/react-native') as {
  v2: typeof V2;
};

function eventKey(sequence: number): V2.EventKey {
  return v2.EventKey.create({
    collection: 8,
    identity: 'me',
    signedBy: v2.PublicKey.create({ key: new Uint8Array([1, 2, 3]) }),
    sequence: BigInt(sequence),
  });
}

function targetBundle(
  key: V2.EventKey,
  claimEventKey: V2.EventKey,
  targetIdentities: string[],
): V2.EventBundle {
  const content = v2.Content.create({
    contentBody: {
      oneofKind: 'verificationTarget',
      verificationTarget: { claimEventKey, targetIdentities },
    },
  });
  const event = v2.Event.create({ key, createdAt: 1000n });
  return v2.EventBundle.create({
    signedEvent: v2.SignedEvent.create({
      eventBytes: v2.Event.toBinary(event),
      signature: new Uint8Array([0]),
    }),
    serializedContent: v2.SerializedContent.create({
      contentBytes: v2.Content.toBinary(content),
    }),
  });
}

const CLAIM_KEY = eventKey(7);
const CLAIM_ID = Buffer.from(v2.EventKey.toBinary(CLAIM_KEY)).toString('hex');
const OTHER_CLAIM_KEY = eventKey(8);

const CLAIM: DecodedClaim = {
  id: CLAIM_ID,
  schemaName: 'Freeform',
  fields: [],
  identity: 'me',
  keyFingerprint: 'fp',
  sequence: 7n,
  createdAt: 0n,
};

function renderHook(claim: DecodedClaim = CLAIM): {
  current: ReturnType<typeof useRemoveVerifier>;
} {
  const result = { current: null as never };
  function Probe() {
    result.current = useRemoveVerifier(claim) as never;
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return result;
}

/** The Delete event keys committed, in order. */
function deletedKeys(): V2.EventKey[] {
  return mockClient.commitEvent.mock.calls.map(([, content]) => {
    const body = (content as V2.Content).contentBody;
    if (body.oneofKind !== 'delete' || !body.delete.eventKey) {
      throw new Error('expected a delete');
    }
    return body.delete.eventKey;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.activeIdentityKey = 'me';
  mockClient.listValidEvents.mockReturnValue([
    targetBundle(eventKey(10), CLAIM_KEY, ['them']),
    targetBundle(eventKey(11), CLAIM_KEY, ['other']),
    targetBundle(eventKey(12), OTHER_CLAIM_KEY, ['them']),
  ]);
});

describe('removeVerifier', () => {
  it('tombstones only the target naming the verifier on this claim', async () => {
    await removeVerifier(mockClient as never, CLAIM_ID, 'them');

    expect(deletedKeys()).toEqual([expect.objectContaining({ sequence: 10n })]);
    expect(mockClient.sync).toHaveBeenCalledWith('partial-push');
  });

  it('tombstones every matching target', async () => {
    mockClient.listValidEvents.mockReturnValue([
      targetBundle(eventKey(10), CLAIM_KEY, ['them']),
      targetBundle(eventKey(13), CLAIM_KEY, ['them']),
    ]);

    await removeVerifier(mockClient as never, CLAIM_ID, 'them');

    expect(deletedKeys().map((k) => k.sequence)).toEqual([10n, 13n]);
  });

  it('is a no-op without a matching target', async () => {
    await removeVerifier(mockClient as never, CLAIM_ID, 'nobody');

    expect(mockClient.commitEvent).not.toHaveBeenCalled();
    expect(mockClient.sync).not.toHaveBeenCalled();
  });

  it('is a no-op without an active identity', async () => {
    mockClient.activeIdentityKey = null;

    await removeVerifier(mockClient as never, CLAIM_ID, 'them');

    expect(mockClient.listValidEvents).not.toHaveBeenCalled();
    expect(mockClient.commitEvent).not.toHaveBeenCalled();
  });

  it('does not throw when the push fails', async () => {
    mockClient.sync.mockRejectedValueOnce(new Error('offline'));

    await expect(
      removeVerifier(mockClient as never, CLAIM_ID, 'them'),
    ).resolves.toBeUndefined();
    expect(mockClient.commitEvent).toHaveBeenCalled();
  });
});

describe('useRemoveVerifier', () => {
  it('deletes the target and refreshes the affected queries', async () => {
    const hook = renderHook();
    await act(() => hook.current.submit('them'));

    expect(deletedKeys()).toHaveLength(1);
    expect(invalidateQuery).toHaveBeenCalledWith(mockClient, [
      'verification-targets',
      CLAIM_ID,
    ]);
    expect(invalidateQuery).toHaveBeenCalledWith(mockClient, [
      'claims-list',
      'me',
    ]);
    expect(invalidateQuery).toHaveBeenCalledWith(mockClient, [
      'targeted-verification-claims',
      'them',
    ]);
  });

  it('reports pending while the removal runs', async () => {
    let finish: () => void = () => {};
    mockClient.sync.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        finish = () => resolve(undefined);
      }),
    );

    const hook = renderHook();
    expect(hook.current.isPending).toBe(false);

    let done: Promise<void> = Promise.resolve();
    await act(() => {
      done = hook.current.submit('them');
    });
    expect(hook.current.isPending).toBe(true);
    await expect(act(() => hook.current.submit('them'))).rejects.toBe(
      'Already pending',
    );

    await act(async () => {
      finish();
      await done;
    });
    expect(hook.current.isPending).toBe(false);
  });
});
