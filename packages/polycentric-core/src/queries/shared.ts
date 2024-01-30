import { CancelContext } from '../cancel-context';

export type UnregisterCallback = () => void;

export const DuplicatedCallbackError = new Error('duplicated callback');
export const ImpossibleError = new Error('impossible');
export const CancelledError = new Error('cancelled');

export type CacheState<T> = {
    contextHold: CancelContext;
    state: T;
};

export function updateCacheState<K, T>(
    cache: Map<K, CacheState<T>>,
    queriedStateKey: K,
    queriedState: T,
    getContextHolds: (state: T) => Set<CancelContext>,
    cleanup: (key: K, state: T) => void,
): void {
    const existingCacheState = cache.get(queriedStateKey);

    if (existingCacheState) {
        cache.delete(queriedStateKey);
        cache.set(queriedStateKey, existingCacheState);
    } else {
        if (cache.size > 100) {
            const oldestEntry = cache.entries().next().value;

            console.log('evicting', oldestEntry[0]);

            cache.delete(oldestEntry[0]);

            getContextHolds(oldestEntry[1].state).delete(
                oldestEntry[1].contextHold,
            );

            cleanup(oldestEntry[0], oldestEntry[1].state);
        }

        const newCacheState = {
            contextHold: new CancelContext(),
            state: queriedState,
        };

        getContextHolds(queriedState).add(newCacheState.contextHold);

        cache.set(queriedStateKey, newCacheState);
    }
}
