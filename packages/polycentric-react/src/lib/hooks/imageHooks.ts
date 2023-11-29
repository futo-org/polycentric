import { Models, Protocol } from '@polycentric/polycentric-core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlobQuery } from './queryHooks'

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
  const [imageURL, setImageURL] = useState<string | undefined>(undefined)

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

  useEffect(() => {
    let currentURL: string | undefined
    if (blob) {
      currentURL = URL.createObjectURL(blob)
      setImageURL(currentURL)
    } else {
      setImageURL(undefined)
    }

    return () => {
      if (currentURL) {
        URL.revokeObjectURL(currentURL)
      }
    }
  }, [blob])

  return imageURL
}
