import {
  APIMethods,
  CancelContext,
  Models,
  ProcessHandle,
  Protocol,
  Queries,
  Ranges,
  Util,
} from '@polycentric/polycentric-core'
import Long from 'long'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useProcessHandleManager } from './processHandleManagerHooks'

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

export const useUsernameCRDTQuery = (system?: Models.PublicKey.PublicKey) => {
  return useCRDTQuery(system, Models.ContentType.ContentTypeUsername, Util.decodeText)
}

export const useTextPublicKey = (system: Models.PublicKey.PublicKey, maxLength?: number) => {
  return useMemo<string>(() => {
    const string = Models.PublicKey.toString(system)
    if (maxLength) {
      return string.slice(0, maxLength)
    } else {
      return string
    }
  }, [system, maxLength])
}

export const useSystemLink = (system: Models.PublicKey.PublicKey) => {
  const { processHandle } = useProcessHandleManager()

  const [link, setLink] = useState<string | undefined>(undefined)
  useEffect(() => {
    setLink(undefined)
    const cancelContext = new CancelContext.CancelContext()
    ProcessHandle.makeSystemLink(processHandle, system).then((link) => {
      if (cancelContext.cancelled()) {
        return
      }
      setLink('/user/' + link)
    })
    return () => {
      cancelContext.cancel()
    }
  }, [processHandle, system])

  return link
}

export const useEventLink = (system: Models.PublicKey.PublicKey, pointer: Models.Pointer.Pointer) => {
  const { processHandle } = useProcessHandleManager()
  const [link, setLink] = useState<string | undefined>(undefined)
  useEffect(() => {
    setLink(undefined)
    const cancelContext = new CancelContext.CancelContext()
    ProcessHandle.makeEventLink(processHandle, system, pointer).then((link) => {
      if (cancelContext.cancelled()) {
        return
      }
      setLink('/post/' + link)
    })
    return () => {
      cancelContext.cancel()
    }
  }, [processHandle, system, pointer])
  return link
}

export const useDateFromUnixMS = (unixMS: Long | undefined) => {
  return useMemo<Date | undefined>(() => {
    if (unixMS === undefined) {
      return undefined
    }

    return new Date(unixMS.toNumber())
  }, [unixMS])
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

export const useAvatar = (system?: Models.PublicKey.PublicKey): string | undefined => {
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

export class ParsedEvent<T> {
  signedEvent: Models.SignedEvent.SignedEvent
  event: Models.Event.Event
  value: T

  constructor(signedEvent: Models.SignedEvent.SignedEvent, event: Models.Event.Event, value: T) {
    this.signedEvent = signedEvent
    this.event = event
    this.value = value
  }
}

export type ClaimInfo<T> = {
  cell: Queries.QueryIndex.Cell
  parsedEvent: ParsedEvent<T> | undefined
}

export function useIndex<T>(
  system: Models.PublicKey.PublicKey,
  contentType: Models.ContentType.ContentType,
  parse: (buffer: Uint8Array) => T,
  batchSize = 30,
): [Array<ParsedEvent<T>>, () => void] {
  const queryManager = useQueryManager()

  const [state, setState] = useState<Array<ClaimInfo<T>>>([])

  const latestHandle = useRef<Queries.QueryIndex.QueryHandle | undefined>(undefined)

  useEffect(() => {
    setState([])

    const cancelContext = new CancelContext.CancelContext()

    const cb = (value: Queries.QueryIndex.CallbackParameters) => {
      if (cancelContext.cancelled()) {
        return
      }

      const toAdd = value.add.map((cell) => {
        let parsedEvent: ParsedEvent<T> | undefined = undefined

        if (cell.signedEvent !== undefined) {
          const signedEvent = Models.SignedEvent.fromProto(cell.signedEvent)
          const event = Models.Event.fromBuffer(signedEvent.event)
          const parsed = parse(event.content)

          parsedEvent = new ParsedEvent<T>(signedEvent, event, parsed)
        }

        return {
          cell: cell,
          parsedEvent: parsedEvent,
        }
      })

      setState((state) => {
        return state
          .filter((x) => !value.remove.has(x.cell.key))
          .concat(toAdd)
          .sort((x, y) => Queries.QueryIndex.compareCells(y.cell, x.cell))
      })
    }

    latestHandle.current = queryManager.queryIndex.query(system, contentType, cb)

    latestHandle.current.advance(batchSize)

    return () => {
      cancelContext.cancel()

      latestHandle.current?.unregister()
    }
  }, [queryManager, system, contentType, parse, batchSize])

  const parsedEvents = useMemo(() => {
    return state.map((x) => x.parsedEvent).filter((x) => x !== undefined) as ParsedEvent<T>[]
  }, [state])

  const advanceCallback = useCallback(() => {
    latestHandle.current?.advance(batchSize)
  }, [batchSize])

  return [parsedEvents, advanceCallback]
}

export const useQueryReferences = (
  system: Models.PublicKey.PublicKey | undefined,
  reference: Protocol.Reference | undefined,
  cursor?: Uint8Array,
  requestEvents?: Protocol.QueryReferencesRequestEvents,
  countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
  countReferences?: Protocol.QueryReferencesRequestCountReferences[],
): Protocol.QueryReferencesResponse[] | undefined => {
  const [state, setState] = useState<Protocol.QueryReferencesResponse[] | undefined>(undefined)
  const { processHandle } = useProcessHandleManager()

  useEffect(() => {
    setState(undefined)

    if (system === undefined || reference === undefined) return

    const cancelContext = new CancelContext.CancelContext()

    const fetchQueryReferences = async () => {
      try {
        const systemState = await processHandle.loadSystemState(system)
        const servers = systemState.servers()

        const responses = await Promise.allSettled(
          servers.map((server) =>
            APIMethods.getQueryReferences(
              server,
              reference,
              cursor,
              requestEvents,
              countLwwElementReferences,
              countReferences,
            ),
          ),
        )
        const fulfilledResponses = responses
          .filter((response) => response.status === 'fulfilled')
          .map((response) => (response as PromiseFulfilledResult<Protocol.QueryReferencesResponse>).value)

        if (cancelContext.cancelled() === false) {
          setState(fulfilledResponses)
        }
      } catch (error) {
        console.error(error)
      }
    }

    fetchQueryReferences()

    return () => {
      cancelContext.cancel()
    }
  }, [system, reference, cursor, requestEvents, countLwwElementReferences, countReferences, processHandle])

  return state
}

export const useQueryPointerReferences = (
  pointer: Models.Pointer.Pointer,
  cursor?: Uint8Array,
  requestEvents?: Protocol.QueryReferencesRequestEvents,
  countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
  countReferences?: Protocol.QueryReferencesRequestCountReferences[],
) => {
  const { system } = pointer
  const reference = useMemo(() => Models.pointerToReference(pointer), [pointer])

  return useQueryReferences(system, reference, cursor, requestEvents, countLwwElementReferences, countReferences)
}

// Declare explicitly so they don't cause a useEffect rerender
const postStatsRequestEvents = {
  fromType: Models.ContentType.ContentTypePost,
  countLwwElementReferences: [],
  countReferences: [],
}

const postStatLwwElementReferences = [
  {
    fromType: Models.ContentType.ContentTypeOpinion,
    value: Models.Opinion.OpinionLike,
  },
  {
    fromType: Models.ContentType.ContentTypeOpinion,
    value: Models.Opinion.OpinionDislike,
  },
]

const postStatReferences = [
  {
    fromType: Models.ContentType.ContentTypePost,
  },
]

export const usePostStats = (pointer: Models.Pointer.Pointer) => {
  const out = useQueryPointerReferences(
    pointer,
    undefined,
    postStatsRequestEvents,
    postStatLwwElementReferences,
    postStatReferences,
  )

  const counts = useMemo(() => {
    if (out === undefined)
      return {
        likes: undefined,
        dislikes: undefined,
        comments: undefined,
      }

    let likes = 0
    let dislikes = 0
    let comments = 0

    out?.forEach((response) => {
      likes += response.counts[0].toNumber()
      dislikes += response.counts[1].toNumber()
      comments += response.counts[2].toNumber()
    })

    return {
      likes,
      dislikes,
      comments,
    }
  }, [out])

  return counts
}

export const useQueryIfAdded = (
  contentType: Models.ContentType.ContentType,
  system?: Models.PublicKey.PublicKey,
  value?: Uint8Array,
) => {
  const { processHandle } = useProcessHandleManager()
  const [state, setState] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (system === undefined || value === undefined) {
      setState(undefined)
      return
    }

    const cancelContext = new CancelContext.CancelContext()
    processHandle
      .store()
      .crdtElementSetIndex.queryIfAdded(system, contentType, value)
      .then((result) => {
        if (cancelContext.cancelled()) {
          return
        }
        setState(result)
      })

    return () => {
      cancelContext.cancel()
    }
  }, [processHandle, system, contentType, value])

  return state
}

export function useQueryCursor<T>(
  loadCallback: Queries.QueryCursor.LoadCallback,
  parse: (buffer: Uint8Array) => T,
  batchSize = 30,
): [Array<ParsedEvent<T>>, () => void] {
  const { processHandle } = useProcessHandleManager()
  const [state, setState] = useState<Array<ParsedEvent<T>>>([])
  const query = useRef<Queries.QueryCursor.Query | null>(null)
  const [advance, setAdvance] = useState<() => void>(() => {
    return () => {}
  })

  const addNewCells = useCallback(
    (newCells: Queries.QueryCursor.Cell[]) => {
      const newCellsAsSignedEvents = newCells.map((cell) => {
        const { signedEvent } = cell
        const event = Models.Event.fromBuffer(signedEvent.event)
        const parsed = parse(event.content)
        processHandle.addAddressHint(event.system, cell.fromServer)
        return new ParsedEvent<T>(signedEvent, event, parsed)
      })
      setState((currentCells) => [...currentCells].concat(newCellsAsSignedEvents))
    },
    [parse, processHandle],
  )

  useEffect(() => {
    setState([])
    setAdvance(() => () => {})
    const newQuery = new Queries.QueryCursor.Query(processHandle, loadCallback, addNewCells, batchSize)
    query.current = newQuery
    setAdvance(() => query.current?.advance.bind(query.current) ?? (() => {}))
    return () => {
      newQuery.cleanup()
    }
    // NOTE: Currently we don't care about dynamic batch sizes.
    // If we do, the current implementation of this hook will result in clearing the whole feed when the batch size changes.
  }, [processHandle, loadCallback, addNewCells, batchSize])

  return [state, advance]
}

export function useQueryEvent<T>(
  system: Models.PublicKey.PublicKey,
  process: Models.Process.Process,
  logicalClock: Long,
  parse: (buffer: Uint8Array) => T,
): ParsedEvent<T> | undefined {
  const queryManager = useQueryManager()

  const [parsedEvent, setParsedEvent] = useState<ParsedEvent<T> | undefined>(undefined)

  useEffect(() => {
    setParsedEvent(undefined)

    if (system !== undefined) {
      const cancelContext = new CancelContext.CancelContext()

      const unregister = queryManager.queryEvent.query(
        system,
        process,
        logicalClock,
        (signedEvent: Models.SignedEvent.SignedEvent | undefined) => {
          if (cancelContext.cancelled()) {
            return
          }

          let parsedEvent: ParsedEvent<T> | undefined = undefined

          if (signedEvent !== undefined) {
            const event = Models.Event.fromBuffer(signedEvent.event)
            const parsed = parse(event.content)

            parsedEvent = new ParsedEvent<T>(signedEvent, event, parsed)
          }

          setParsedEvent(parsedEvent)
        },
      )

      return () => {
        cancelContext.cancel()
        unregister()
      }
    }
  }, [queryManager, system, process, logicalClock, parse])

  return parsedEvent
}

export function useQueryPost(
  system: Models.PublicKey.PublicKey,
  process: Models.Process.Process,
  logicalClock: Long,
): ParsedEvent<Protocol.Post> | undefined {
  return useQueryEvent(system, process, logicalClock, Protocol.Post.decode)
}
