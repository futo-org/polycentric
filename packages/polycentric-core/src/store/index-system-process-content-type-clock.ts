import Long from 'long';

import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';
import * as Util from '../util';
import { HasIngest } from './has-ingest';
import * as IndexEvents from './index-events';

export type Key = Readonly<Uint8Array> & {
    readonly __tag: unique symbol;
};

const buffer255 = new Uint8Array([255]);

interface KeyStruct {
    readonly system: Models.PublicKey.PublicKey;
    readonly process: Models.Process.Process;
    readonly logicalClock: Long;
    readonly contentType: Models.ContentType.ContentType;
}

export function encodeKey(key: KeyStruct): Key {
    return Util.concatBuffers([
        Util.encodeText(Models.PublicKey.toString(key.system)),
        buffer255,
        Util.encodeText(Models.Process.toString(key.process)),
        buffer255,
        Util.encodeText(key.contentType.toNumber().toString(16)),
        buffer255,
        Util.encodeText(key.logicalClock.toNumber().toString(16)),
    ]) as Key;
}

export function encodeKeyBoundary(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    contentType: Models.ContentType.ContentType,
    high: boolean,
): Key {
    const segments = [
        Util.encodeText(Models.PublicKey.toString(system)),
        buffer255,
        Util.encodeText(Models.Process.toString(process)),
        buffer255,
        Util.encodeText(contentType.toNumber().toString(16)),
        buffer255,
    ];

    if (high) {
        segments.push(buffer255);
    }

    return Util.concatBuffers(segments) as Key;
}

export class IndexSystemProcessContentTypeClock implements HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;
    private readonly indexEvents: IndexEvents.IndexEvents;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
        indexEvents: IndexEvents.IndexEvents,
    ) {
        this.level = registerSublevel('indexSystemProcessContentTypeClock');
        this.indexEvents = indexEvents;
    }

    public async getLatest(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        contentType: Models.ContentType.ContentType,
    ): Promise<Models.SignedEvent.SignedEvent | undefined> {
        const rows: Uint8Array[] = await this.level
            .values({
                lt: encodeKeyBoundary(system, process, contentType, true),
                gt: encodeKeyBoundary(system, process, contentType, false),
                limit: 1,
                reverse: true,
            })
            .all();

        if (rows.length > 0) {
            return await this.indexEvents.getSignedEventByKey(rows[0]);
        } else {
            return undefined;
        }
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const actions: PersistenceDriver.BinaryUpdateLevel[] = [];

        const eventKey = IndexEvents.makeEventKey(
            event.system,
            event.process,
            event.logicalClock,
        );

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteBody = Models.Delete.fromBuffer(event.content);

            actions.push({
                type: 'put',
                key: encodeKey({
                    system: event.system,
                    process: deleteBody.process,
                    logicalClock: deleteBody.logicalClock,
                    contentType: deleteBody.contentType,
                }),
                value: eventKey,
                sublevel: this.level,
            });
        }

        const key = encodeKey({
            system: event.system,
            process: event.process,
            logicalClock: event.logicalClock,
            contentType: event.contentType,
        });

        if (!(await PersistenceDriver.tryLoadKey(this.level, key))) {
            actions.push({
                type: 'put',
                key: key,
                value: eventKey,
                sublevel: this.level,
            });
        }

        return actions;
    }
}
