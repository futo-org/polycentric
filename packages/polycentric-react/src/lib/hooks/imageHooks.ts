import { Models, Protocol } from '@polycentric/polycentric-core'
import { toSvg } from 'jdenticon'
import Long from 'long'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { avatarResolutions } from '../util/imageProcessing'
import { useBlobQuery, useCRDTQuery, useTextPublicKey } from './queryHooks'

const blobURLCache = new Map<Blob, { url: string; count: number }>()

export const useBlobDisplayURL = (blob?: Blob): string | undefined => {
  const [blobURL, setBlobURL] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (blob) {
      let cacheEntry = blobURLCache.get(blob)
      if (!cacheEntry) {
        const newURL = URL.createObjectURL(blob)
        cacheEntry = { url: newURL, count: 1 }
        blobURLCache.set(blob, cacheEntry)
      } else {
        cacheEntry.count++
      }
      setBlobURL(cacheEntry.url)
    } else {
      setBlobURL(undefined)
    }

    return () => {
      if (blob) {
        const cacheEntry = blobURLCache.get(blob)
        if (cacheEntry) {
          cacheEntry.count--
          if (cacheEntry.count === 0) {
            URL.revokeObjectURL(cacheEntry.url)
            blobURLCache.delete(blob)
          }
        }
      }
    }
  }, [blob])

  return blobURL
}

export const useImageManifestDisplayURL = (
  system?: Models.PublicKey.PublicKey,
  manifest?: Protocol.ImageManifest | null,
): string | undefined => {
  const { process, sections, mime } = useMemo(() => {
    const process = manifest?.process ? Models.Process.fromProto(manifest.process) : undefined
    const sections = manifest?.sections
    const mime = manifest?.mime

    return { process, sections, mime }
  }, [manifest])

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

  const stringKey = useTextPublicKey(system)

  const jdenticonSrc = useMemo(() => {
    if (manifest == null) {
      const svgString = toSvg(stringKey, 100)
      const svg = new Blob([svgString], { type: 'image/svg+xml' })
      return URL.createObjectURL(svg)
    }
  }, [manifest, stringKey])

  const manifestDisplayURL = useImageManifestDisplayURL(system, manifest)
  const displayURL = manifest === null ? jdenticonSrc : manifestDisplayURL

  return displayURL
}
