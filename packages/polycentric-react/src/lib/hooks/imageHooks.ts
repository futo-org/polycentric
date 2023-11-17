import { Models, Protocol } from '@polycentric/polycentric-core'
import { useCallback, useEffect, useState } from 'react'
import { useBlobQuery } from './queryHooks'

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
