import { useEffect, useMemo, useState } from 'react';
import * as RXJS from 'rxjs';

export const useDebouncedEffect = (
    effect: () => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deps: any[],
    delay: number,
) => {
    useEffect(() => {
        const handler = setTimeout(effect, delay);
        return () => clearTimeout(handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
};

export type ObservableCacheItem<T> = {
    value: T | undefined;
    callbacks: Set<(value: T) => void>;
    unsubscribe: () => void;
    timeoutMilliseconds: number;
    generation: number;
};

export function useObservableWithCache<T>(
    cache: Map<string, ObservableCacheItem<T>>,
    cacheKey: string,
    cacheTimeoutMilliseconds: number,
    observable: RXJS.Observable<T>,
): T | undefined {
    const [state, setState] = useState<T | undefined>(() => {
        const item = cache.get(cacheKey);
        return item ? item.value : undefined;
    });

    useEffect(() => {
        const potentialItem = cache.get(cacheKey);

        if (potentialItem) {
            setState((state) => {
                if (state === potentialItem.value) {
                    return state;
                }
                return potentialItem.value;
            });
        }

        const item: ObservableCacheItem<T> = potentialItem
            ? potentialItem
            : {
                  value: undefined,
                  callbacks: new Set(),
                  unsubscribe: () => {},
                  timeoutMilliseconds: cacheTimeoutMilliseconds,
                  generation: 0,
              };

        const cb = (value: T) => {
            setState(value);
        };

        item.generation++;
        item.callbacks.add(cb);

        if (potentialItem === undefined) {
            cache.set(cacheKey, item);

            const subscription = observable.subscribe((value: T) => {
                item.value = value;
                item.callbacks.forEach((cb) => cb(value));
            });

            item.unsubscribe = () => {
                subscription.unsubscribe();
            };
        }

        const finalize = (initial: boolean, generation: number) => {
            if (item.callbacks.size === 0) {
                if (
                    item.timeoutMilliseconds === 0 ||
                    (item.generation === generation && !initial)
                ) {
                    item.unsubscribe();
                    cache.delete(cacheKey);
                } else {
                    setTimeout(() => {
                        finalize(false, item.generation);
                    }, item.timeoutMilliseconds);
                }
            }
        };

        return () => {
            item.callbacks.delete(cb);

            finalize(true, item.generation);

            setState(undefined);
        };
    }, [cache, cacheKey, cacheTimeoutMilliseconds, observable]);

    return state;
}

export const useTopicLink = (topic: string | undefined): string | undefined => {
    return useMemo(() => {
        if (!topic) {
            return undefined;
        }

        let urlTopic = topic;
        if (topic.startsWith('/')) urlTopic = topic.substring(1);

        return `/t/${encodeURIComponent(urlTopic)}`;
    }, [topic]);
};
