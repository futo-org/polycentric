import { useEffect, useRef } from 'react';
import {
  FetchMode,
  type Query,
  type QueryOpts,
  QueryStatus,
  type PolycentricClient,
} from '@polycentric/react-native';
import { create } from 'zustand';
import { toast } from '../../components/toast';
import { usePolycentric } from '../../lib/polycentric-hooks/context';

/**
 * Either a `Query` value or a function that can produce a `Query` from a previous
 * query's results.
 */
export type QuerySource =
  | Query
  | ((status: QueryStatus | undefined, data: ArrayBuffer | undefined) => Query);

export type QueryRef = {
  /** Latest query response data received from rs-core. */
  data: ArrayBuffer | undefined;

  /** The overall status of the fan-out query. */
  status: QueryStatus;

  /** Error message from rs-core, if any. */
  error: string | null;

  /**
   * The number of servers from the latest fan-out that have returned a
   * success response.
   */
  successfulServers: number;

  /**
   * The number of servers from the latest fan-out for which we are
   * still awaiting a response.
   */
  pendingServers: number | undefined;

  /**
   * Set to true when `refresh()` is called and reset
   * to false once any server responds or the query completes.
   * This helps listeners distinguish between extending with more data versus
   * refreshing with fresh data in the cases where the existing data is not
   * invalidated immediately.
   */
  hasPendingRefresh: boolean;
};

export enum RefreshStrategy {
  /**
   * Leave existing cached data as-is and start a new fan-out.
   * The cached response for each server will be replaced as new responses arrive.
   */
  Fetch,

  /**
   * Clear rust-side cache, but keep the data in the javascript-side cache
   * until any new data arrives.
   */
  Lazy,

  /**
   * Clear all cached data and start a fan-out.
   */
  Eager,
}

export type QueryKey = string[];

/**
 * Keys are hierachial: a prefix matches itself and everything under it, so
 * `['feed']` covers `['feed', 'explore', …]`.
 */
export function isUnderQueryKey(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}\0`);
}

type QueryArgs = {
  client: PolycentricClient;
  queryKey: QueryKey;
  query: Query;
  opts: QueryOpts | undefined;
};

type SubscriptionRef = {
  refCount: number;
  dispose: () => void;
  args: QueryArgs;
};

type QueryStoreState = {
  queries: Map<string, QueryRef>;
  subscriptions: Map<string, SubscriptionRef>;
  subscribe: (key: string, args: QueryArgs) => void;
  unsubscribe: (key: string) => void;
  refresh: (strategy: RefreshStrategy, key: string, args?: QueryArgs) => void;
  extend: (key: string, args: QueryArgs) => void;
};

const EMPTY_ENTRY: QueryRef = Object.freeze({
  data: undefined,
  status: QueryStatus.Loading,
  error: null,
  successfulServers: 0,
  pendingServers: undefined,
  hasPendingRefresh: false,
});

const LOADING_ENTRY: Partial<QueryRef> = Object.freeze({
  status: QueryStatus.Loading,
  error: null,
  successfulServers: 0,
  pendingServers: undefined,
});

// A slow server times out every in-flight query at once; toast once per
// window rather than per query.
const SLOW_SERVER_TOAST_THROTTLE_MS = 30_000;
let lastSlowServerToastAt = 0;

function notifySlowServer(message: string) {
  const server = message.match(/^timeout \[([^\]]+)\]/)?.[1];
  if (!server) return;

  const now = Date.now();
  if (now - lastSlowServerToastAt < SLOW_SERVER_TOAST_THROTTLE_MS) return;
  lastSlowServerToastAt = now;

  let host = server;
  try {
    host = new URL(server).host;
  } catch {}
  toast.warning(`${host} is responding slowly`);
}

const QUERY_CACHE_KEY = '__polycentricQueryCache';
type QueryCacheGlobal = typeof globalThis & {
  [QUERY_CACHE_KEY]?: Map<string, QueryRef>;
};
const queryCacheGlobal = globalThis as QueryCacheGlobal;

export const useQueryStore = create<QueryStoreState>((set, get) => {
  const updateQueryRef = (key: string, patch: Partial<QueryRef>) => {
    set((state) => {
      const prev = state.queries.get(key) ?? EMPTY_ENTRY;
      const merged = { ...prev, ...patch };
      if (
        merged.data === prev.data &&
        merged.status === prev.status &&
        merged.error === prev.error &&
        merged.successfulServers === prev.successfulServers &&
        merged.pendingServers === prev.pendingServers &&
        merged.hasPendingRefresh === prev.hasPendingRefresh
      ) {
        return state;
      }
      const next = new Map(state.queries);
      next.set(key, merged);
      return { queries: next };
    });
  };

  // Use this to force a query to reach to servers for new data.
  const forceRemote = (args: QueryArgs): QueryArgs => {
    return {
      ...args,
      opts: { ...args.opts, fetchMode: FetchMode.Default },
    };
  };

  const fetch = (
    key: string,
    args: QueryArgs,
    initState: Partial<QueryRef>,
  ): (() => void) => {
    // Set query to loading state
    updateQueryRef(key, initState);

    // Request from rs-core
    const observable = args.client.core.fetchQuery(
      args.queryKey,
      args.query,
      args.opts,
    );
    // Listen for outputs from relevant servers
    const sub = observable.subscribe({
      next(result) {
        const patch: Partial<QueryRef> = {
          status: result.status,
          successfulServers: result.successfulServers,
          pendingServers: result.pendingServers,
        };

        const hasData = get().queries.get(key)?.data !== undefined;
        const localEmpty =
          result.successfulServers === 0 && result.data?.byteLength === 0;
        if (result.data !== undefined && !(hasData && localEmpty)) {
          patch.data = result.data;
        }

        if (result.pendingServers === 0 || result.successfulServers > 0) {
          patch.hasPendingRefresh = false;
        }

        updateQueryRef(key, patch);
      },
      error(message) {
        console.warn(`useQuery[${key}] error: ${message}`);
        notifySlowServer(message);
        if (get().queries.get(key)?.status === QueryStatus.Error) {
          updateQueryRef(key, { error: message });
        }
      },
      complete() {
        // All query results are usually given to us from `next()` emissions.
        // However, we do need to handle the case where an offline query has no cached
        // data, leaving the query to complete without `next()` ever being called.
        let status = get().queries.get(key)?.status;
        if (status === undefined || status === QueryStatus.Loading) {
          // Treat no emissions as a success with no data
          status = QueryStatus.Success;
        }

        updateQueryRef(key, {
          status,
          hasPendingRefresh: false,
        });
      },
    });
    // Dispose of the subscription if we cancel the fetch
    return () => sub.unsubscribe();
  };

  return {
    queries: queryCacheGlobal[QUERY_CACHE_KEY] ?? new Map(),
    subscriptions: new Map(),

    subscribe(key, args) {
      const entry = get().queries.get(key);
      const hasData = entry?.data !== undefined;

      // Resetting a populated entry to `Loading` re-renders every other
      // consumer of the key, and scrolling remounts rows constantly.
      const initState = hasData ? {} : LOADING_ENTRY;

      const recover = !hasData && entry?.status === QueryStatus.Error;
      const fetchArgs = recover ? forceRemote(args) : args;

      const existing = get().subscriptions.get(key);
      if (existing) {
        existing.refCount += 1;
        existing.args = args;

        if (recover || args.opts?.fetchMode === FetchMode.Default) {
          existing.dispose();
          existing.dispose = fetch(key, fetchArgs, initState);
        }

        return;
      }
      get().subscriptions.set(key, {
        refCount: 1,
        dispose: fetch(key, fetchArgs, initState),
        args,
      });
    },

    unsubscribe(key) {
      const subscription = get().subscriptions.get(key);
      if (!subscription) return;
      subscription.refCount -= 1;
      if (subscription.refCount === 0) {
        subscription.dispose();
        get().subscriptions.delete(key);
      }
    },

    refresh(strategy, key, args) {
      const sub = get().subscriptions.get(key);
      if (!sub) return;

      // Invalidate rust-side cache
      if (strategy !== RefreshStrategy.Fetch) {
        sub.args.client.core.invalidateQuery(sub.args.queryKey);
      }

      // Update javascript-side query store entry
      const patch: Partial<QueryRef> = {
        ...LOADING_ENTRY,
        hasPendingRefresh: true,
      };

      if (strategy === RefreshStrategy.Eager) {
        patch.data = undefined;
      }

      // Fan-out
      const next = forceRemote(args ?? sub.args);
      sub.dispose();
      sub.args = next;
      sub.dispose = fetch(key, next, patch);
    },

    extend(key, args) {
      const sub = get().subscriptions.get(key);
      if (!sub) return;

      sub.dispose();
      sub.dispose = fetch(key, args, LOADING_ENTRY);
    },
  };
});

useQueryStore.subscribe((state) => {
  queryCacheGlobal[QUERY_CACHE_KEY] = state.queries;
});

export type UseQueryResult = QueryRef & {
  /**
   * True if we are still expecting emissions from the subscription.
   * Either we are waiting on at least one server or we are waiting on
   * the cached data.
   */
  isLoading: boolean;

  /**
   * Flush local caches as specified by `strategy` and then start a fan-out
   * query.
   */
  refresh: (strategy: RefreshStrategy) => void;

  /**
   * Pull in new data after generating args from the query source, but without
   * updating the subscription's query args.
   * If the update mode is set to `Merge`, this allows pulling in more data
   * while still keeping all of the existing data.
   */
  extend: () => void;
};

/**
 * Invalidate the rust-side cache for a key partition and refresh every
 * subscriber under it. If `lazy` is true (default), existing data stays
 * until new data arrives.
 */
export function invalidateQuery(
  client: PolycentricClient,
  queryKey: QueryKey,
  lazy?: boolean,
) {
  lazy = lazy ?? true;
  const prefix = queryKey.join('\0');

  // Clears the rust-side cache for the whole partition, subscribed or not.
  client.core.invalidateQuery(queryKey);

  const strat = lazy ? RefreshStrategy.Lazy : RefreshStrategy.Eager;

  const state = useQueryStore.getState();
  for (const key of [...state.subscriptions.keys()]) {
    if (isUnderQueryKey(key, prefix)) state.refresh(strat, key);
  }
}

/**
 * Invalidate every cached query: the rust-side cache is dropped wholesale
 * and every active subscription starts a lazy refresh (existing data stays
 * visible until new data arrives). Use after changes that affect what any
 * query could return, e.g. the identity's server list changing.
 */
export function invalidateAllQueries(client: PolycentricClient) {
  client.core.invalidateAllQueries();

  const state = useQueryStore.getState();
  for (const key of state.subscriptions.keys()) {
    state.refresh(RefreshStrategy.Lazy, key);
  }
}

/**
 * Returns the current cache for a query key
 */
export function getQueryCache(queryKey: QueryKey): QueryRef | undefined {
  return useQueryStore.getState().queries.get(queryKey.join('\0'));
}

/**
 * Updates the local cache state for a query key
 */
export function setQueryCache(
  queryKey: QueryKey,
  value: Partial<QueryRef>,
): void {
  const cacheKey = queryKey.join('\0');
  useQueryStore.setState((state) => {
    const prev = state.queries.get(cacheKey) ?? EMPTY_ENTRY;
    const merged = { ...prev, ...value };
    if (
      merged.data === prev.data &&
      merged.status === prev.status &&
      merged.error === prev.error &&
      merged.successfulServers === prev.successfulServers &&
      merged.pendingServers === prev.pendingServers &&
      merged.hasPendingRefresh === prev.hasPendingRefresh
    ) {
      return state;
    }
    const next = new Map(state.queries);
    next.set(cacheKey, merged);
    return { queries: next };
  });
}

/**
 * Subscribe to a rust-core query and share its state across every consumer using
 * the same `queryKey`.
 * The first consumer kicks off the rust-side fan-out, and subsequent consumers
 * refcount onto the same subscription, sharing the same query results.
 * Set `enabled` to `false` to skip the subscription entirely (the hook still
 * returns cached state if any).
 *
 * Extending/infinite queries can be done by using the "merge" update mode and
 * providing a function for the query source.
 * Then, calling `extend()` will keep the query key and subscription the same,
 * while triggering a new fan-out that will be added to the existing data.
 */
export function useQuery(
  queryKey: QueryKey,
  querySource: QuerySource,
  opts: QueryOpts = { fetchMode: FetchMode.Default },
  enabled = true,
): UseQueryResult {
  const client = usePolycentric();
  const cacheKey = queryKey.join('\0');

  const entry = useQueryStore((s) => s.queries.get(cacheKey) ?? EMPTY_ENTRY);
  const query =
    typeof querySource === 'function'
      ? querySource(undefined, undefined)
      : querySource;

  // Keep `argsRef` pointing at the freshest call args so the
  // imperative handlers below always see them without needing the
  // effect to re-run.
  const argsRef = useRef<QueryArgs>({ client, queryKey, query, opts });
  argsRef.current = { client, queryKey, query, opts };

  useEffect(() => {
    if (!enabled) return;
    const { subscribe: attach, unsubscribe: detach } = useQueryStore.getState();
    attach(cacheKey, argsRef.current);
    return () => detach(cacheKey);
  }, [cacheKey, enabled]);

  return {
    ...entry,
    isLoading: enabled && entry.status === QueryStatus.Loading,
    refresh: (strategy) =>
      useQueryStore.getState().refresh(strategy, cacheKey, argsRef.current),
    extend: () => {
      const query =
        typeof querySource === 'function'
          ? querySource(entry.status, entry.data)
          : querySource;

      useQueryStore
        .getState()
        .extend(cacheKey, { client, queryKey, query, opts });
    },
  };
}
