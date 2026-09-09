// `@polycentric/react-native`'s barrel pulls in native uniffi init at import
// time, which can't run under jest — expose just what the hooks need.
jest.mock('@polycentric/react-native', () => ({
  v2: jest.requireActual('../../../../../../packages/js-core/src/proto/v2'),
  COLLECTION: { VERIFICATIONS: 8 },
  SyncStrategy: { PARTIAL_PUSH: 'partial-push' },
}));

// ESM-only; jest-expo doesn't transform it. The digest content is irrelevant.
jest.mock('@noble/hashes/sha2.js', () => ({
  sha256: () => new Uint8Array(32),
}));

let mockSequence = 0;
const mockClient = {
  contentManager: { save: jest.fn(async () => undefined) },
  buildEvent: jest.fn(async () => {
    const { v2 } = jest.requireMock('@polycentric/react-native');
    return v2.Event.create({
      key: v2.EventKey.create({
        identity: 'me',
        collection: 8,
        sequence: BigInt(++mockSequence),
        signedBy: v2.PublicKey.create({ key: new Uint8Array([1, 2, 3]) }),
      }),
    });
  }),
  signEvent: jest.fn(async (event: unknown) => ({ event })),
  commitEvent: jest.fn(
    async (_signed: unknown, _content: unknown) => undefined,
  ),
  sync: jest.fn(async () => undefined),
};

jest.mock('@/src/common/lib/polycentric-hooks', () => ({
  usePolycentric: () => mockClient,
  useCurrentIdentity: () => ({ identityKey: 'me' }),
  hexToBytes: (hex: string) => Buffer.from(hex, 'hex'),
}));

jest.mock('@/src/common/lib/polycentric-hooks/helpers', () => ({
  getKeyFingerprint: (key?: unknown) => (key ? 'fingerprint' : undefined),
  eventKeyId: (key: unknown) => {
    const { v2 } = jest.requireMock('@polycentric/react-native');
    return Buffer.from(v2.EventKey.toBinary(key)).toString('hex');
  },
}));

jest.mock('@/src/common/query/hooks/useQuery', () => ({
  invalidateQuery: jest.fn(),
}));

let mockRequestFrom: string | undefined;
jest.mock('../claims/create/ClaimCreateContext', () => ({
  useClaimCreateOptions: () => ({ requestFrom: mockRequestFrom }),
}));

import { invalidateQuery } from '@/src/common/query/hooks/useQuery';
import type { v2 } from '@polycentric/react-native';
import * as React from 'react';
import { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { formToSchema } from '../utils/schemas';
import useCreateClaim, { type ClaimRef } from './useCreateClaim';

const SCHEMA = formToSchema({
  name: 'Occupation',
  fields: [{ key: 'job_title', label: 'Job Title', required: true }],
});

type HookResult = ReturnType<typeof useCreateClaim>;

function renderHook(): { current: HookResult } {
  const result: { current: HookResult } = { current: null as never };
  function Probe() {
    result.current = useCreateClaim();
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return result;
}

async function submit(values: Record<string, string>) {
  const hook = renderHook();
  let ref: ClaimRef | undefined;
  await act(async () => {
    ref = await hook.current.submit({ schema: SCHEMA, values });
  });
  return ref;
}

/** Content committed by the nth commitEvent call. */
function committedContent(call: number): v2.Content {
  return mockClient.commitEvent.mock.calls[call][1] as v2.Content;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSequence = 0;
  mockRequestFrom = undefined;
});

describe('useCreateClaim', () => {
  it('commits a claim event and returns its ref', async () => {
    const ref = await submit({ job_title: 'Developer' });

    expect(mockClient.commitEvent).toHaveBeenCalledTimes(1);
    const content = committedContent(0);
    if (content.contentBody.oneofKind !== 'verificationClaim') {
      throw new Error('expected a verificationClaim');
    }
    const fields = content.contentBody.verificationClaim.fields;
    expect(new TextDecoder().decode(fields.job_title)).toBe('Developer');

    expect(mockClient.sync).toHaveBeenCalledWith('partial-push');
    expect(invalidateQuery).toHaveBeenCalledWith(mockClient, [
      'claims-list',
      'me',
    ]);
    expect(ref).toEqual({
      id: expect.any(String),
      identity: 'me',
      keyFingerprint: 'fingerprint',
      sequence: '1',
    });
  });

  it('omits empty fields from the claim', async () => {
    await submit({ job_title: 'Developer', description: '  ' });

    const content = committedContent(0);
    if (content.contentBody.oneofKind !== 'verificationClaim') {
      throw new Error('expected a verificationClaim');
    }
    expect(Object.keys(content.contentBody.verificationClaim.fields)).toEqual([
      'job_title',
    ]);
  });

  it('also publishes a target when requesting from an identity', async () => {
    mockRequestFrom = 'them';
    await submit({ job_title: 'Developer' });

    expect(mockClient.commitEvent).toHaveBeenCalledTimes(2);
    const content = committedContent(1);
    if (content.contentBody.oneofKind !== 'verificationTarget') {
      throw new Error('expected a verificationTarget');
    }
    const target = content.contentBody.verificationTarget;
    expect(target.targetIdentities).toEqual(['them']);
    // Points at the claim event committed first.
    expect(target.claimEventKey?.sequence).toBe(1n);
  });

  it('does not publish a target without requestFrom', async () => {
    await submit({ job_title: 'Developer' });

    expect(mockClient.commitEvent).toHaveBeenCalledTimes(1);
  });
});
