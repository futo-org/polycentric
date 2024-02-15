import Long from 'long';

import * as PersistenceDriver from '../persistence-driver';
import * as Models from '../models';
import * as Util from '../util';
import * as IndexEvents from './index-events';
import { HasIngest } from './has-ingest';

export const MIN_8BYTE_KEY = new Uint8Array(8).fill(0);
export const MAX_8BYTE_KEY = new Uint8Array(8).fill(255);

export const MAX_16BYTE_KEY = new Uint8Array(16).fill(255);

export const MIN_32BYTE_KEY = new Uint8Array(32).fill(0);
export const MAX_32BYTE_KEY = new Uint8Array(32).fill(255);

function indexSystemContentTypeUnixMillisecondsProcessKeySuffix(
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
): Uint8Array {
    return Util.concatBuffers([
        new Uint8Array(system.keyType.toBytesBE()),
        system.key,
        new Uint8Array(contentType.toBytesBE()),
    ]);
}

function indexSystemContentTypeUnixMillisecondsProcessKey(
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
    unixMilliseconds: Long | undefined,
    process: Models.Process.Process | undefined,
): Uint8Array {
    return Util.concatBuffers([
        new Uint8Array(system.keyType.toBytesBE()),
        system.key,
        new Uint8Array(contentType.toBytesBE()),
        unixMilliseconds
            ? new Uint8Array(unixMilliseconds.toBytesBE())
            : MAX_8BYTE_KEY,
        process ? process.process : MAX_16BYTE_KEY,
    ]);
}

export class IndexEventsForSystemByTime extends HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;
    private readonly indexEvents: IndexEvents.IndexEvents;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
        indexEvents: IndexEvents.IndexEvents,
    ) {
        super();

        this.level = registerSublevel(
            'indexSystemContentTypeUnixMillisecondsProcess',
        );
        this.indexEvents = indexEvents;
    }

    /* eslint @typescript-eslint/require-await: 0 */
    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        if (event.unixMilliseconds === undefined) {
            throw Error('expected unixMilliseconds');
        }

        const indexKey = indexSystemContentTypeUnixMillisecondsProcessKey(
            event.system,
            event.contentType,
            event.unixMilliseconds,
            event.process,
        );

        const eventKey = IndexEvents.makeEventKey(
            event.system,
            event.process,
            event.logicalClock,
        );

        return [
            {
                type: 'put',
                key: indexKey,
                value: eventKey,
                sublevel: this.level,
            },
        ];
    }

    public deleteIndexSystemContentTypeUnixMillisecondsProcess(
        event: Models.Event.Event,
    ): PersistenceDriver.BinaryDelLevel {
        if (event.unixMilliseconds === undefined) {
            throw Error('expected unixMilliseconds');
        }

        const indexKey = indexSystemContentTypeUnixMillisecondsProcessKey(
            event.system,
            event.contentType,
            event.unixMilliseconds,
            event.process,
        );

        return {
            type: 'del',
            key: indexKey,
            sublevel: this.level,
        };
    }

    public async queryIndexSystemContentTypeUnixMillisecondsProcess(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        unixMilliseconds: Long | undefined,
        limit: number,
    ): Promise<Models.SignedEvent.SignedEvent[]> {
        const suffix = indexSystemContentTypeUnixMillisecondsProcessKeySuffix(
            system,
            contentType,
        );

        const key = indexSystemContentTypeUnixMillisecondsProcessKey(
            system,
            contentType,
            unixMilliseconds,
            undefined,
        );

        const rows = await this.level
            .iterator({
                lt: key,
                limit: unixMilliseconds ? limit + 1 : limit,
                reverse: true,
            })
            .all();

        const result = [];

        for (const [k, value] of rows) {
            if (!Util.bufferSuffixMatch(k, suffix)) {
                continue;
            }

            const signedEvent =
                await this.indexEvents.getSignedEventByKey(value);

            if (signedEvent === undefined) {
                continue;
            }

            const event = Models.Event.fromBuffer(signedEvent.event);

            if (
                event.unixMilliseconds === undefined ||
                (unixMilliseconds &&
                    event.unixMilliseconds.greaterThanOrEqual(unixMilliseconds))
            ) {
                continue;
            }

            result.push(signedEvent);
        }

        return result;
    }
}
