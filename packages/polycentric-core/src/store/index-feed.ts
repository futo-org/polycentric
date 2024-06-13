import Long from 'long';

import * as Store from '.';
import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';
import * as Protocol from '../protocol';
import * as Util from '../util';
import { HasIngest } from './has-ingest';
import * as IndexEvents from './index-events';

export type IndexFeedCursor = Readonly<Uint8Array> & {
    readonly __tag: unique symbol;
};

export interface QueryResult {
    items: Models.SignedEvent.SignedEvent[];
    cursor: IndexFeedCursor | undefined;
}

const buffer255 = new Uint8Array([255]);

export function makeKey(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
    unixMilliseconds: Long,
): IndexFeedCursor {
    return Util.concatBuffers([
        Util.encodeText(unixMilliseconds.toNumber().toString(16)),
        buffer255,
        IndexEvents.makeEventKey(system, process, logicalClock),
    ]) as IndexFeedCursor;
}

export function extractSystemFromCursor(
    cursor: IndexFeedCursor,
): Models.PublicKey.PublicKey {
    const startOfEventKey = cursor.findIndex((x) => x == 255) + 1;

    if (startOfEventKey === 0) {
        throw Error('malformed cursor');
    }

    const keyType = Long.fromBytesBE(
        Array.from(cursor.subarray(startOfEventKey, startOfEventKey + 8)),
        true,
    );

    // uint8 + process
    const endSize = 8 + 16;

    const key = cursor.subarray(startOfEventKey + 8, -endSize);

    return Models.PublicKey.fromProto({
        keyType: keyType,
        key: key,
    });
}

export function extractEventKeyFromCursor(cursor: IndexFeedCursor): Uint8Array {
    const startOfEventKey = cursor.findIndex((x) => x == 255) + 1;

    if (startOfEventKey === 0) {
        throw Error('malformed cursor');
    }

    return cursor.subarray(startOfEventKey);
}

export class IndexFeed implements HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;
    private readonly store: Store.Store;

    constructor(
        store: Store.Store,
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
    ) {
        (this.store = store), (this.level = registerSublevel('indexFeed'));
    }

    /* eslint @typescript-eslint/require-await: 0 */
    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteBody = Models.Delete.fromBuffer(event.content);

            if (
                deleteBody.unixMilliseconds === undefined ||
                !deleteBody.contentType.equals(
                    Models.ContentType.ContentTypePost,
                )
            ) {
                return [];
            }

            return [
                {
                    type: 'del',
                    key: makeKey(
                        event.system,
                        deleteBody.process,
                        deleteBody.logicalClock,
                        deleteBody.unixMilliseconds,
                    ),
                    sublevel: this.level,
                },
            ];
        } else if (
            event.contentType.equals(Models.ContentType.ContentTypePost)
        ) {
            if (event.unixMilliseconds === undefined) {
                console.warn('IndexFeed expected event.unixMilliseconds');

                return [];
            }

            return [
                {
                    type: 'put',
                    key: makeKey(
                        event.system,
                        event.process,
                        event.logicalClock,
                        event.unixMilliseconds,
                    ),
                    value: new Uint8Array(),
                    sublevel: this.level,
                },
            ];
        }

        return [];
    }

    public async query(
        limit: number,
        cursor: IndexFeedCursor | undefined,
    ): Promise<QueryResult> {
        if (this.store.system === undefined) {
            throw Error('must set store.system before query');
        }

        const storeSystem = this.store.system;

        const keys: IndexFeedCursor[] = await this.level
            .keys({
                ...(cursor && { lt: cursor }),
                limit: limit,
                reverse: true,
            })
            .all();

        const queryEnded: boolean = keys.length < limit;

        const result: Models.SignedEvent.SignedEvent[] = [];

        await Promise.all(
            keys.map(async (key) => {
                const system = extractSystemFromCursor(key);

                const following =
                    await this.store.indexCRDTElementSet.queryIfAdded(
                        storeSystem,
                        Models.ContentType.ContentTypeFollow,
                        Protocol.PublicKey.encode(system).finish(),
                    );

                if (following) {
                    const signedEvent =
                        await this.store.indexEvents.getSignedEventByKey(
                            extractEventKeyFromCursor(key),
                        );

                    if (signedEvent) {
                        result.push(signedEvent);
                    } else {
                        console.warn('expected signed event');
                    }
                }
            }),
        );

        return {
            items: result,
            cursor:
                !queryEnded && keys.length > 1
                    ? keys[keys.length - 1]
                    : undefined,
        };
    }
}
