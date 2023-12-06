import { Models, Protocol } from '@polycentric/polycentric-core';
import Long from 'long';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { avatarResolutions } from '../util/imageProcessing';
import { useBlobQuery, useCRDTQuery } from './queryHooks';

const urlCache: Map<Blob, { url: string; count: number; timeoutId?: number }> = new Map()

export const useBlobDisplayURL = (blob?: Blob): string | undefined => {
  const cacheEntry = useRef<{ url: string; count: number; timeoutId?: number } | null>(null)
  const [blobURL, setBlobURL] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (blob) {
      let entry = urlCache.get(blob)
      if (!entry) {
        const url = URL.createObjectURL(blob)
        entry = { url, count: 1 }
        urlCache.set(blob, entry)
      } else {
        entry.count += 1
        if (entry.timeoutId) {
          clearTimeout(entry.timeoutId)
          entry.timeoutId = undefined
        }
      }
      cacheEntry.current = entry
      setBlobURL(entry.url)
    } else {
      setBlobURL(undefined)
    }

    return () => {
      if (cacheEntry.current && blob) {
        cacheEntry.current.count -= 1
        if (cacheEntry.current.count === 0) {
          cacheEntry.current.timeoutId = window.setTimeout(() => {
            if (cacheEntry.current?.url) URL.revokeObjectURL(cacheEntry.current.url)
            urlCache.delete(blob)
          }, 10000)
        }
      }
    }
  }, [blob])

  return blobURL
}

export const useImageManifestDisplayURL = (
  system?: Models.PublicKey.PublicKey,
  manifest?: Protocol.ImageManifest,
): string | undefined => {
  const process = manifest?.process ? Models.Process.fromProto(manifest.process) : undefined
  const sections = manifest?.sections
  const mime = manifest?.mime

  const parseBlob = useCallback(
    (buffer: Uint8Array) => {
      return new Blob([buffer], {
        type: mime,
      })
    },
    [mime],
  )

  const blob = useBlobQuery(system, process, sections, parseBlob)

  const imageURL = useBlobDisplayURL(blob)

  return imageURL
}

const decodeAvatarImageBundle = (rawImageBundle: Uint8Array, squareHeight: number) => {
  const imageBundle = Protocol.ImageBundle.decode(rawImageBundle)

  const manifest = imageBundle.imageManifests.find((manifest) => {
    return manifest.height.equals(Long.fromNumber(squareHeight)) && manifest.width.equals(Long.fromNumber(squareHeight))
  })

  if (manifest === undefined) {
    return undefined
  }

  return manifest
}

const makeImageBundleDecoder = (squareHeight: number) => {
  return (rawImageBundle: Uint8Array) => {
    return decodeAvatarImageBundle(rawImageBundle, squareHeight)
  }
}

export const useAvatar = (
  system?: Models.PublicKey.PublicKey,
  size: keyof typeof avatarResolutions = 'lg',
): string | undefined => {
  const decoder = useMemo(() => {
    const squareHeight = avatarResolutions[size]
    return makeImageBundleDecoder(squareHeight)
  }, [size])

  const manifest = useCRDTQuery(system, Models.ContentType.ContentTypeAvatar, decoder)

  return useImageManifestDisplayURL(system, manifest)
}
