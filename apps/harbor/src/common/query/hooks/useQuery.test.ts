jest.mock('@polycentric/react-native', () => ({
  FetchMode: {
    Default: 'Default',
    OfflineFirst: 'OfflineFirst',
    OfflineOnly: 'OfflineOnly',
  },
  QueryStatus: { Loading: 'Loading', Success: 'Success', Error: 'Error' },
}));
jest.mock('../../components/toast', () => ({
  toast: { warning: jest.fn() },
}));
jest.mock('../../lib/polycentric-hooks/context', () => ({
  usePolycentric: jest.fn(),
}));

import { FetchMode, QueryStatus } from '@polycentric/react-native';
import { useQueryStore } from './useQuery';

type Observer = {
  next: (result: {
    data?: Uint8Array;
    status: QueryStatus;
    successfulServers: number;
    pendingServers: number;
  }) => void;
  error: (message: string) => void;
  complete: () => void;
};

const fetchQuery = jest.fn();
let observers: Observer[] = [];
const client = {
  core: {
    fetchQuery,
    invalidateQuery: jest.fn(),
  },
} as never;

const KEY = 'profile\0abc';
const DATA = new Uint8Array([1, 2, 3]);

function args(fetchMode: FetchMode) {
  return {
    client,
    queryKey: ['profile', 'abc'],
    query: {} as never,
    opts: { fetchMode } as never,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  observers = [];
  fetchQuery.mockImplementation(() => ({
    subscribe: (observer: Observer) => {
      observers.push(observer);
      return { unsubscribe: jest.fn() };
    },
  }));
  useQueryStore.setState({ queries: new Map(), subscriptions: new Map() });
});

function latest(): Observer {
  return observers[observers.length - 1] as Observer;
}

function seed() {
  useQueryStore.getState().subscribe(KEY, args(FetchMode.Default));
  latest().next({
    data: DATA,
    status: QueryStatus.Success,
    successfulServers: 1,
    pendingServers: 0,
  });
  expect(useQueryStore.getState().queries.get(KEY)?.data).toBe(DATA);
}

describe('useQueryStore data retention', () => {
  it('keeps existing data when every server fails on an empty cache', () => {
    seed();
    latest().next({
      data: undefined,
      status: QueryStatus.Error,
      successfulServers: 0,
      pendingServers: 0,
    });
    const entry = useQueryStore.getState().queries.get(KEY);
    expect(entry?.data).toBe(DATA);
    expect(entry?.status).toBe(QueryStatus.Error);
  });

  it('does not let an offline-only read replace server data', () => {
    seed();
    useQueryStore.getState().unsubscribe(KEY);

    useQueryStore.getState().subscribe(KEY, args(FetchMode.OfflineOnly));
    latest().next({
      data: new Uint8Array([]),
      status: QueryStatus.Success,
      successfulServers: 0,
      pendingServers: 0,
    });
    expect(useQueryStore.getState().queries.get(KEY)?.data).toBe(DATA);
  });

  it('accepts a non-empty local read over existing data', () => {
    seed();
    const local = new Uint8Array([4, 5]);
    latest().next({
      data: local,
      status: QueryStatus.Success,
      successfulServers: 0,
      pendingServers: 0,
    });
    expect(useQueryStore.getState().queries.get(KEY)?.data).toBe(local);
  });

  it('accepts server data over existing data', () => {
    seed();
    const fresh = new Uint8Array([9]);
    latest().next({
      data: fresh,
      status: QueryStatus.Success,
      successfulServers: 1,
      pendingServers: 0,
    });
    expect(useQueryStore.getState().queries.get(KEY)?.data).toBe(fresh);
  });

  it('accepts a local snapshot when nothing is held yet', () => {
    useQueryStore.getState().subscribe(KEY, args(FetchMode.OfflineOnly));
    latest().next({
      data: DATA,
      status: QueryStatus.Success,
      successfulServers: 0,
      pendingServers: 0,
    });
    expect(useQueryStore.getState().queries.get(KEY)?.data).toBe(DATA);
  });
});

describe('useQueryStore hot reload', () => {
  it('mirrors cached queries onto globalThis for the next module instance', () => {
    seed();
    const mirrored = (
      globalThis as { __polycentricQueryCache?: Map<string, unknown> }
    ).__polycentricQueryCache;
    expect(mirrored).toBe(useQueryStore.getState().queries);
    expect(mirrored?.get(KEY)).toBeDefined();
  });
});

describe('useQueryStore recovery', () => {
  it('retries against the servers when a consumer joins an errored empty entry', () => {
    useQueryStore.getState().subscribe(KEY, args(FetchMode.OfflineOnly));
    latest().next({
      data: undefined,
      status: QueryStatus.Error,
      successfulServers: 0,
      pendingServers: 0,
    });
    expect(fetchQuery).toHaveBeenCalledTimes(1);

    useQueryStore.getState().subscribe(KEY, args(FetchMode.OfflineOnly));
    expect(fetchQuery).toHaveBeenCalledTimes(2);
    expect(fetchQuery.mock.calls[1]?.[2]).toEqual({
      fetchMode: FetchMode.Default,
    });
    expect(useQueryStore.getState().queries.get(KEY)?.status).toBe(
      QueryStatus.Loading,
    );
  });

  it('leaves a healthy subscription alone for offline-only consumers', () => {
    seed();
    useQueryStore.getState().subscribe(KEY, args(FetchMode.OfflineOnly));
    expect(fetchQuery).toHaveBeenCalledTimes(1);
  });
});
