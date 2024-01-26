import Long from 'long';

import * as PersistenceDriver from '../persistence-driver';
import * as Models from '../models';
import * as Util from '../util';
import * as IndexEvents from './index-events';
import { HasIngest } from './has-ingest';

export type Key = Readonly<Uint8Array> & {
    readonly __tag: unique symbol;
};

const buffer255 = new Uint8Array([255]);

type KeyStruct = {
    readonly system: Models.PublicKey.PublicKey;
    readonly process: Models.Process.Process;
    readonly logicalClock: Long;
    readonly contentType: Models.ContentType.ContentType;
};

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

function decodeNumber(buffer: Uint8Array): Long {
    return Long.fromNumber(parseInt(Util.decodeText(buffer), 16));
}

export function decodeKey(key: Key) {
    const segments = Util.splitUint8Array(key, 255);

    if (segments.length !== 4) {
        throw Error('invalid segment count');
    }

    return {
        system: Models.PublicKey.fromString(
            Util.decodeText(segments[0]) as Models.PublicKey.PublicKeyString,
        ),
        process: Models.Process.fromString(
            Util.decodeText(segments[1]) as Models.Process.ProcessString,
        ),
        contentType: decodeNumber(
            segments[2],
        ) as Models.ContentType.ContentType,
        logicalClock: decodeNumber(segments[3]),
    };
}

export class IndexSystemProcessContentTypeClock extends HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
    ) {
        super();

        this.level = registerSublevel('indexSystemProcessContentTypeClock');
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<Array<PersistenceDriver.BinaryUpdateLevel>> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const actions: Array<PersistenceDriver.BinaryUpdateLevel> = [];

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
