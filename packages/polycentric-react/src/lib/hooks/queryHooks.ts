import { encode } from '@borderless/base64'
import { CancelContext, Models, Protocol, Queries, Ranges, Util } from '@polycentric/polycentric-core'
import Long from 'long'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// Since we create query managers based on the driver passed in, we set the query managers value at the root of the app.
// With this, it will never be undefined - but since typescript doesn't know that, we ignore the error.
// @ts-ignore
export const QueryManagerContext = createContext<Queries.QueryManager.QueryManager>()

export function useQueryManager(): Queries.QueryManager.QueryManager {
  return useContext(QueryManagerContext)
}

export function useCRDTQuery<T>(
  system: Models.PublicKey.PublicKey | undefined,
  contentType: Models.ContentType.ContentType,
  parse: (buffer: Uint8Array) => T,
): T | undefined {
  const queryManager = useQueryManager()
  const [state, setState] = useState<T | undefined>(undefined)

  useEffect(() => {
    setState(undefined)

    if (system !== undefined) {
      const cancelContext = new CancelContext.CancelContext()

      const unregister = queryManager.queryCRDT.query(system, contentType, (buffer: Uint8Array) => {
        if (cancelContext.cancelled()) {
          return
        }

        setState(parse(buffer))
      })

      return () => {
        cancelContext.cancel()
        unregister()
      }
    }
  }, [queryManager, system, contentType, parse])

  return state
}

export const useUsernameCRDTQuery = (system: Models.PublicKey.PublicKey) => {
  return useCRDTQuery(system, Models.ContentType.ContentTypeUsername, (buffer: Uint8Array) => Util.decodeText(buffer))
}

export const useTextPublicKey = (system: Models.PublicKey.PublicKey) => {
  return useMemo<string>(() => {
    return encode(system.key)
  }, [system])
}

export function useBlobQuery<T>(
  system: Models.PublicKey.PublicKey | undefined,
  process: Models.Process.Process | undefined,
  range: Ranges.IRange[] | undefined,
  parse: (buffer: Uint8Array) => T,
): T | undefined {
  const queryManager = useQueryManager()
  const [state, setState] = useState<T | undefined>(undefined)

  useEffect(() => {
    setState(undefined)

    if (system !== undefined && process !== undefined && range !== undefined) {
      const cancelContext = new CancelContext.CancelContext()

      const unregister = queryManager.queryBlob.query(system, process, range, (buffer: Uint8Array) => {
        if (cancelContext.cancelled()) {
          return
        }

        setState(parse(buffer))
      })

      return () => {
        cancelContext.cancel()

        unregister()
      }
    }
  }, [system, process, range, queryManager, parse])

  return state
}

const decodeImageManifest = (rawImageBundle: Uint8Array) => {
  const imageBundle = Protocol.ImageBundle.decode(rawImageBundle)

  const manifest = imageBundle.imageManifests.find((manifest) => {
    return manifest.height.equals(Long.fromNumber(256)) && manifest.width.equals(Long.fromNumber(256))
  })

  if (manifest === undefined) {
    throw new Error('manifest missing 256x256')
  }

  if (!manifest.process) {
    throw new Error('manifest missing process')
  }

  return {
    process: Models.Process.fromProto(manifest.process),
    sections: manifest.sections,
    mime: manifest.mime,
  }
}

export const useAvatar = (system: Models.PublicKey.PublicKey): string | undefined => {
  const [avatarLink, setAvatarLink] = useState<string | undefined>(undefined)

  const manifest = useCRDTQuery(system, Models.ContentType.ContentTypeAvatar, decodeImageManifest)

  const { process, sections, mime } = manifest ?? {}

  const parseAvatarBlob = useCallback(
    (buffer: Uint8Array) => {
      return new Blob([buffer], {
        type: mime,
      })
    },
    [mime],
  )

  const avatarBlob = useBlobQuery(system, process, sections, parseAvatarBlob)

  useEffect(() => {
    let currentURL: string | undefined
    if (avatarBlob) {
      currentURL = URL.createObjectURL(avatarBlob)
      setAvatarLink(currentURL)
    } else {
      setAvatarLink(undefined)
    }

    return () => {
      if (currentURL) {
        URL.revokeObjectURL(currentURL)
      }
    }
  }, [avatarBlob])

  return avatarLink
}
