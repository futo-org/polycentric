import { encode } from '@borderless/base64'
import { Models, Protocol, Queries, Ranges, Util } from '@polycentric/polycentric-core'
import Long from 'long'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Since we create query managers based on the driver passed in, we set the query managers value at the root of the app.
// With this, it will never be undefined - but since typescript doesn't know that, we ignore the error.
// @ts-ignore
export const QueryManagerContext = createContext<Queries.QueryManager.QueryManager>()

export function useQueryManager(): Queries.QueryManager.QueryManager {
  return useContext(QueryManagerContext)
}

export function useCRDTQuery<T>(
  contentType: Models.ContentType.ContentType,
  system: Models.PublicKey.PublicKey,
  parse: (buffer: Uint8Array) => T,
): [T | undefined, boolean, () => boolean] {
  const [data, setData] = useState<T | undefined>()
  const [loaded, setLoaded] = useState(false)

  const queryManager = useQueryManager()

  // Use a ref to track if the component is still mounted
  const isCancelled = useRef(false)

  // A ref to track the current content type and system
  const currentParams = useRef({ contentType, system })

  useEffect(() => {
    isCancelled.current = false
    currentParams.current = { contentType, system }
    return () => {
      // When the component unmounts, update the isMounted ref
      isCancelled.current = true
    }
  }, [])

  useEffect(() => {
    currentParams.current = { contentType, system }

    const unregister = queryManager.queryCRDT.query(system, contentType, (buffer: Uint8Array) => {
      // Only set data if the component is still mounted and the content and system are still the same
      if (
        isCancelled.current === false &&
        currentParams.current.contentType === contentType &&
        currentParams.current.system === system
      ) {
        setData(parse(buffer))
        setLoaded(true)
      }
    })

    // Unregister when either contentType or system changes
    return () => {
      unregister()
    }
  }, [contentType, system, queryManager, parse])

  const cancel = () => {
    const alreadyCancelled = isCancelled.current
    isCancelled.current = true
    return alreadyCancelled
  }

  return [data, loaded, cancel]
}

export const useUsernameCRDTQuery = (system: Models.PublicKey.PublicKey) => {
  return useCRDTQuery(Models.ContentType.ContentTypeUsername, system, (buffer: Uint8Array) => Util.decodeText(buffer))
}

export const useTextPublicKey = (system: Models.PublicKey.PublicKey) => {
  return useMemo<string>(() => {
    return encode(system.key)
  }, [system])
}

export function useBlobQuery<T>(
  system: Models.PublicKey.PublicKey,
  parse: (buffer: Uint8Array) => T,
  process?: Models.Process.Process,
  range?: Ranges.IRange[],
): [T | undefined, boolean, () => boolean] {
  const [data, setData] = useState<T | undefined>()
  const [loaded, setLoaded] = useState(false)

  const queryManager = useQueryManager()

  // Use a ref to track if the component is still mounted
  const isCancelled = useRef(false)
  const currentParams = useRef({ system, process, range })

  useEffect(() => {
    isCancelled.current = false
    return () => {
      // When the component unmounts, update the isMounted ref
      isCancelled.current = true
    }
  }, [])

  useEffect(() => {
    currentParams.current = { system, process, range }

    if (!process || !range) {
      return
    }

    const unregister = queryManager.queryBlob.query(system, process, range, (buffer: Uint8Array) => {
      // Only set data if the component is still mounted and the content and system are still the same
      if (
        isCancelled.current === false &&
        currentParams.current.system === system &&
        currentParams.current.process === process &&
        currentParams.current.range === range
      ) {
        setData(parse(buffer))
        setLoaded(true)
      }
    })

    // Unregister when either contentType or system changes
    return () => {
      unregister()
    }
  }, [system, process, range, queryManager, parse])

  const cancel = () => {
    const alreadyCancelled = isCancelled.current
    isCancelled.current = true
    return alreadyCancelled
  }

  return [data, loaded, cancel]
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

export const useAvatar = (
  system: Models.PublicKey.PublicKey,
): [string | undefined, [boolean, boolean, boolean], () => void] => {
  const [manifest, manifestLoaded, cancelManifest] = useCRDTQuery(
    Models.ContentType.ContentTypeAvatar,
    system,
    decodeImageManifest,
  )

  const { process, sections, mime } = manifest || {}

  const [avatarLink, setAvatarLink] = useState<string | undefined>(undefined)
  const [avatarLoaded, setAvatarLoaded] = useState(false)

  const [avatarBlob, blobLoaded, cancelAvatarBlob] = useBlobQuery(
    system,
    (rawImage: Uint8Array) => {
      return new Blob([rawImage], {
        type: mime,
      })
    },
    process,
    sections,
  )

  useEffect(() => {
    let currentURL: string | undefined
    if (avatarBlob) {
      currentURL = URL.createObjectURL(avatarBlob)
      setAvatarLink(currentURL)
      setAvatarLoaded(true)
    } else {
      setAvatarLink(undefined)
    }

    return () => {
      if (currentURL) {
        URL.revokeObjectURL(currentURL)
      }
    }
  }, [avatarBlob])

  useEffect(() => {
    cancelAvatarBlob()
    cancelManifest()
  }, [cancelAvatarBlob, cancelManifest])

  return [
    avatarLink,
    [manifestLoaded, avatarLoaded, blobLoaded],
    () => {
      cancelManifest()
      cancelAvatarBlob()
    },
  ]
}
