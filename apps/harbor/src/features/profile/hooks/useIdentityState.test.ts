jest.mock('@polycentric/react-native', () => ({
  COLLECTION: { IDENTITY: 1 },
}));

let mockSelf: { identityKey: string; servers: string[] } | null = null;
const mockResolveIdentity = jest.fn();
const mockListEvents = jest.fn();
const mockClient = {
  identityManager: { resolveIdentity: mockResolveIdentity },
  listEvents: mockListEvents,
};
jest.mock('@/src/common/lib/polycentric-hooks', () => ({
  usePolycentric: () => mockClient,
  useCurrentIdentity: () => ({ identity: mockSelf }),
}));

import { act, renderHook } from '@testing-library/react-native';
import { useIdentityState } from './useIdentityState';

const IDENTITY =
  'f00df0262908a197391c4cbc619eb11cb6867c90915b6e23a3db7a061def8fc3';

const localState = { identityKey: IDENTITY, servers: ['https://a'] };
const remoteState = {
  identityKey: IDENTITY,
  servers: ['https://a', 'https://b'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSelf = null;
});

describe('useIdentityState', () => {
  it('returns the local state, then re-resolves after hydrating the chain', async () => {
    let finishFetch: () => void = () => undefined;
    mockListEvents.mockReturnValue(
      new Promise<void>((resolve) => {
        finishFetch = resolve;
      }),
    );
    mockResolveIdentity.mockReturnValue(localState);

    const { result } = await renderHook(() => useIdentityState(IDENTITY));

    expect(result.current.state).toEqual(localState);
    expect(result.current.isLoading).toBe(false);
    expect(mockListEvents).toHaveBeenCalledWith({
      identity: IDENTITY,
      collection: 1,
    });

    mockResolveIdentity.mockReturnValue(remoteState);
    await act(async () => {
      finishFetch();
    });

    expect(result.current.state).toEqual(remoteState);
  });

  it('reports loading while nothing is known locally', async () => {
    mockListEvents.mockReturnValue(new Promise(() => undefined));
    mockResolveIdentity.mockReturnValue(null);

    const { result } = await renderHook(() => useIdentityState(IDENTITY));

    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('prefers the provider copy for the active identity', async () => {
    mockSelf = { identityKey: IDENTITY, servers: ['https://mine'] };
    mockListEvents.mockResolvedValue([]);
    mockResolveIdentity.mockReturnValue(localState);

    const { result } = await renderHook(() => useIdentityState(IDENTITY));

    expect(result.current.state).toEqual(mockSelf);
  });

  it('does nothing without an identity key', async () => {
    const { result } = await renderHook(() => useIdentityState(null));

    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockListEvents).not.toHaveBeenCalled();
  });
});
