import { Models, Protocol } from '@polycentric/polycentric-core'
import { toSvg } from 'jdenticon'
import Long from 'long'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { avatarResolutions } from '../util/imageProcessing'
import { useBlobQuery, useCRDTQuery, useTextPublicKey } from './queryHooks'

export const useBlobDisplayURL = (blob?: Blob): string | undefined => {
  const [blobURL, setBlobURL] = useState<string | undefined>(undefined)

  useEffect(() => {
    let currentURL: string | undefined
    if (blob) {
      currentURL = URL.createObjectURL(blob)
      setBlobURL(currentURL)
    } else {
      setBlobURL(undefined)
    }

    return () => {
      if (currentURL) {
        URL.revokeObjectURL(currentURL)
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
