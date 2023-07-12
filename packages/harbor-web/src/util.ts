import Long from 'long';
import * as Core from '@polycentric/polycentric-core';

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
