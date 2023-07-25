import Long from 'long';
import * as Core from '@polycentric/polycentric-core';
import * as React from 'react';

// export const server = 'http://localhost:8081';
export const server = 'https://srv1-stg.polycentric.io';

export class ParsedEvent<T> {
    signedEvent: Core.Models.SignedEvent.SignedEvent;
    event: Core.Models.Event.Event;
    value: T;

    constructor(
        signedEvent: Core.Models.SignedEvent.SignedEvent,
        event: Core.Models.Event.Event,
        value: T,
    ) {
        this.signedEvent = signedEvent;
        this.event = event;
        this.value = value;
    }
}

export async function loadImageFromPointer(
    processHandle: Core.ProcessHandle.ProcessHandle,
    pointer: Core.Models.Pointer.Pointer,
) {
    const systemState = await processHandle.loadSystemState(pointer.system);

    for (const server of systemState.servers()) {
        await Core.Synchronization.saveBatch(
            processHandle,
            await Core.APIMethods.getEvents(server, pointer.system, {
                rangesForProcesses: [
                    {
                        process: pointer.process,
                        ranges: [
                            {
                                low: pointer.logicalClock,
                                high: pointer.logicalClock.add(Long.UONE),
                            },
                        ],
                    },
                ],
            }),
        );
    }

    const image = await processHandle.loadBlob(pointer);

    if (image) {
        const blob = new Blob([image.content()], {
            type: image.mime(),
        });

        return URL.createObjectURL(blob);
    }

    console.log('failed to load blob');

    return '';
}

export function useCRDT<T>(
    queryManager: Core.Queries.QueryManager.QueryManager,
    system: Core.Models.PublicKey.PublicKey,
    contentType: Core.Models.ContentType.ContentType,
    parse: (buffer: Uint8Array) => T,
): T | undefined {
    const [state, setState] = React.useState<T | undefined>(undefined);

    React.useEffect(() => {
        setState(undefined);

        const cancelContext = new Core.CancelContext.CancelContext();

        const unregister = queryManager.queryCRDT.query(
            system,
            contentType,
            (buffer: Uint8Array) => {
                if (cancelContext.cancelled()) {
                    return;
                }

                setState(parse(buffer));
            },
        );

        return () => {
            cancelContext.cancel();

            unregister();
        };
    }, [queryManager, system, contentType, parse]);

    return state;
}

export type ClaimInfo<T> = {
    cell: Core.Queries.QueryIndex.Cell;
    parsedEvent: ParsedEvent<T> | undefined;
};

export function useIndex<T>(
    queryManager: Core.Queries.QueryManager.QueryManager,
    system: Core.Models.PublicKey.PublicKey,
    contentType: Core.Models.ContentType.ContentType,
    parse: (buffer: Uint8Array) => T,
): [Array<ClaimInfo<T>>, () => void] {
    const [state, setState] = React.useState<Array<ClaimInfo<T>>>([]);

    const latestCB = React.useRef(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_x: Core.Queries.QueryIndex.CallbackParameters) =>
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            {},
    );

    React.useEffect(() => {
        setState([]);

        const cancelContext = new Core.CancelContext.CancelContext();

        const cb = (value: Core.Queries.QueryIndex.CallbackParameters) => {
            if (cancelContext.cancelled()) {
                return;
            }

            const toAdd = value.add.map((cell) => {
                let parsedEvent: ParsedEvent<T> | undefined = undefined;

                if (cell.signedEvent !== undefined) {
                    const signedEvent = Core.Models.SignedEvent.fromProto(
                        cell.signedEvent,
                    );
                    const event = Core.Models.Event.fromBuffer(
                        signedEvent.event,
                    );
                    const parsed = parse(event.content);

                    parsedEvent = new ParsedEvent<T>(
                        signedEvent,
                        event,
                        parsed,
                    );
                }

                return {
                    cell: cell,
                    parsedEvent: parsedEvent,
                };
            });

            const toRemove = new Set(value.remove);

            setState((state) => {
                return state
                    .filter((x) => !toRemove.has(x.cell))
                    .concat(toAdd)
                    .sort((x, y) =>
                        Core.Queries.QueryIndex.compareCells(y.cell, x.cell),
                    );
            });
        };

        latestCB.current = cb;

        const unregister = queryManager.queryIndex.query(
            system,
            contentType,
            cb,
        );

        queryManager.queryIndex.advance(system, cb, 30);

        return () => {
            cancelContext.cancel();

            unregister();
        };
    }, [queryManager, system, contentType, parse]);

    return [
        state,
        () => {
            queryManager.queryIndex.advance(system, latestCB.current, 30);
        },
    ];
}
