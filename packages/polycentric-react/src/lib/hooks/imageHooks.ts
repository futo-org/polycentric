import { Models, Protocol, Queries } from '@polycentric/polycentric-core';
import { toSvg } from 'jdenticon';
import Long from 'long';
import * as RXJS from 'rxjs';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { avatarResolutions } from '../util/imageProcessing';
import { useBlobQueries, useQueryManager } from './queryHooks';
import { ObservableCacheItem, useObservableWithCache } from './utilHooks';

const blobURLCache = new Map<string, { url: string; count: number }>();

// Simple hash function for blobs
const hashBlob = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  // convert digest to hex string
  const hashArray = Array.from(new Uint8Array(digest));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hashHex;
};

export const useBlobDisplayURL = (blob?: Blob): string | undefined => {
  const memoizedBlobs = useMemo(() => (blob ? [blob] : []), [blob]);
  const url = useBlobDisplayURLs(memoizedBlobs);
  return url.length > 0 ? url[0] : undefined;
};

export const useBlobDisplayURLs = (blobs?: Blob[]): string[] => {
  const [blobURLs, setBlobURLs] = useState<string[]>([]);

  useEffect(() => {
    if (!blobs) {
      setBlobURLs([]);
      return;
    }

    const cacheKeys: string[] = [];
    let revoked = false;

    const manageBlobURLs = async () => {
      const newBlobURLs = [];

      for (const blob of blobs) {
        const cacheKey = await hashBlob(blob);
        cacheKeys.push(cacheKey);
        if (revoked) return;

        let cacheEntry = blobURLCache.get(cacheKey);
        if (!cacheEntry) {
          const newURL = URL.createObjectURL(blob);
          cacheEntry = { url: newURL, count: 1 };
          blobURLCache.set(cacheKey, cacheEntry);
        } else {
          cacheEntry.count++;
        }

        newBlobURLs.push(cacheEntry.url);
      }

      setBlobURLs(newBlobURLs);
    };

    manageBlobURLs();

    return () => {
      revoked = true;
      for (const cacheKey of cacheKeys) {
        const cacheEntry = blobURLCache.get(cacheKey);
        if (cacheEntry) {
          cacheEntry.count--;
          if (cacheEntry.count === 0) {
            URL.revokeObjectURL(cacheEntry.url);
            blobURLCache.delete(cacheKey);
          }
        }
      }
    };
  }, [blobs]);

  return blobURLs;
};

export const useImageManifestDisplayURLs = (
  system?: Models.PublicKey.PublicKey,
  manifests?: Protocol.ImageManifest[],
): string[] => {
  const manifestInfo = useMemo(() => {
    const manifestInfo = [];

    if (!manifests) {
      return [];
    }

    for (const manifest of manifests) {
      const process = manifest?.process
        ? Models.Process.fromProto(manifest.process)
        : undefined;
      const sections = manifest?.sections;
      const mime = manifest?.mime;

      manifestInfo.push({ process, sections, mime });
    }

    return manifestInfo;
  }, [manifests]);

  const parseBlob = useCallback((buffer: Uint8Array, mime: string) => {
    return new Blob([buffer], {
      type: mime,
    });
  }, []);

  const blobs = useBlobQueries(system, manifestInfo, parseBlob);
  const filteredBlobs = useMemo(
    () => blobs.filter((blob) => blob !== undefined) as Blob[],
    [blobs],
  );
  const imageURLs = useBlobDisplayURLs(filteredBlobs);

  return imageURLs;
};

function observableBlobToURL(blob: Blob): RXJS.Observable<string> {
  return new RXJS.Observable((subscriber) => {
    const url = URL.createObjectURL(blob);
    subscriber.next(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  });
}

function observableSystemToBlob(
  system: Models.PublicKey.PublicKey,
): RXJS.Observable<Blob> {
  return new RXJS.Observable((subscriber) => {
    subscriber.next(
      new Blob([toSvg(Models.PublicKey.toString(system), 100)], {
        type: 'image/svg+xml',
      }),
    );
  });
}

const observableAvatar = (
  queryManager: Queries.QueryManager.QueryManager,
  system: Readonly<Models.PublicKey.PublicKey>,
  size: keyof typeof avatarResolutions = 'lg',
): RXJS.Observable<string> => {
  return Queries.QueryCRDT.queryCRDTObservable(
    queryManager.queryCRDT,
    system,
    Models.ContentType.ContentTypeAvatar,
  )
    .pipe(
      RXJS.switchMap((crdtState) => {
        if (crdtState.value) {
          const imageBundle = Protocol.ImageBundle.decode(crdtState.value);
          const resolution = Long.fromNumber(avatarResolutions[size]);
          const manifest = imageBundle.imageManifests.find((manifest) => {
            return (
              manifest.height.equals(resolution) &&
              manifest.width.equals(resolution)
            );
          });

          if (manifest === undefined || manifest.process === undefined) {
            console.warn('manifest or manifest.process missing');
            return observableSystemToBlob(system);
          }

          return Queries.QueryBlob.queryBlobObservable(
            queryManager.queryBlob,
            system,
            Models.Process.fromProto(manifest.process),
            manifest.sections,
          ).pipe(
            RXJS.switchMap((buffer) => {
              if (buffer) {
                return RXJS.of(
                  new Blob([buffer], {
                    type: manifest.mime,
                  }),
                );
              } else {
                return observableSystemToBlob(system);
              }
            }),
          );
        } else {
          return observableSystemToBlob(system);
        }
      }),
    )
    .pipe(RXJS.switchMap((blob) => observableBlobToURL(blob)));
};

const useAvatarCache: Map<string, ObservableCacheItem<string>> = new Map();

export const useAvatar = (
  system: Readonly<Models.PublicKey.PublicKey>,
  size: keyof typeof avatarResolutions = 'lg',
): string | undefined => {
  const queryManager = useQueryManager();

  const cacheKey = useMemo(() => {
    return Models.PublicKey.toString(system) + size;
  }, [system, size]);

  const observable = useMemo(() => {
    return observableAvatar(queryManager, system, size);
  }, [queryManager, system, size]);

  return useObservableWithCache(useAvatarCache, cacheKey, 100, observable);
};

const observableBackground = (
  queryManager: Queries.QueryManager.QueryManager,
  system: Readonly<Models.PublicKey.PublicKey>,
): RXJS.Observable<string> => {
  return Queries.QueryCRDT.queryCRDTObservable(
    queryManager.queryCRDT,
    system,
    Models.ContentType.ContentTypeBanner,
  )
    .pipe(
      RXJS.switchMap((crdtState) => {
        if (crdtState.value) {
          const imageBundle = Protocol.ImageBundle.decode(crdtState.value);
          const manifest = imageBundle.imageManifests[0];

          if (manifest === undefined || manifest.process === undefined) {
            console.warn('manifest or manifest.process missing');
            return observableSystemToBlob(system);
          }

          return Queries.QueryBlob.queryBlobObservable(
            queryManager.queryBlob,
            system,
            Models.Process.fromProto(manifest.process),
            manifest.sections,
          ).pipe(
            RXJS.switchMap((buffer) => {
              if (buffer) {
                return RXJS.of(
                  new Blob([buffer], {
                    type: manifest.mime,
                  }),
                );
              } else {
                return observableSystemToBlob(system);
              }
            }),
          );
        } else {
          return observableSystemToBlob(system);
        }
      }),
    )
    .pipe(RXJS.switchMap((blob) => observableBlobToURL(blob)));
};

const useBackgroundCache: Map<string, ObservableCacheItem<string>> = new Map();

export const useBackground = (
  system: Readonly<Models.PublicKey.PublicKey>,
): string | undefined => {
  const queryManager = useQueryManager();

  const cacheKey = useMemo(() => {
    return Models.PublicKey.toString(system) + 'background';
  }, [system]);

  const observable = useMemo(() => {
    return observableBackground(queryManager, system);
  }, [queryManager, system]);

  return useObservableWithCache(useBackgroundCache, cacheKey, 100, observable);
};
