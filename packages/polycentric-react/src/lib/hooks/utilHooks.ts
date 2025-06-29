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

const decodeBase64Topic = (topic: string): string => {
  const looksLikeBase64 = /^[A-Za-z0-9+/_-]+={0,2}$/.test(topic);
  if (!looksLikeBase64) {
    return topic;
  }

  try {
    // Add padding if necessary so length becomes multiple of 4
    let padded = topic.replace(/-/g, '+').replace(/_/g, '/');
    const mod = padded.length % 4;
    if (mod !== 0) padded += '='.repeat(4 - mod);

    const binary = atob(padded);
    // Convert binary string to Uint8Array then to UTF-8 string
    return new TextDecoder().decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
  } catch {
    // If decoding fails, return original topic
    return topic;
  }
};

export const useTopicLink = (topic: string | undefined): string | undefined => {
  return useMemo(() => {
    if (!topic) {
      return undefined;
    }

    let urlTopic = normalizeTopic(topic);
    if (urlTopic.startsWith('/')) urlTopic = urlTopic.substring(1);

    return `/t/${encodeURIComponent(urlTopic)}`;
  }, [topic]);
};

const urlPrefixRegex = /^((http[s]?:\/\/)?(www\.)?)/;
export const useTopicDisplayText = (
  topic: string | undefined,
): string | undefined => {
  return useMemo(() => {
    if (!topic) {
      return undefined;
    }

    const normalized = normalizeTopic(topic);
    return normalized.replace(urlPrefixRegex, '');
  }, [topic]);
};

export const normalizeTopic = (rawTopic: string): string => {
  let topic = decodeBase64Topic(rawTopic);
  topic = topic.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return topic;
};

export const useNormalizedTopic = (topic?: string): string | undefined => {
  return useMemo(() => (topic ? normalizeTopic(topic) : undefined), [topic]);
};
