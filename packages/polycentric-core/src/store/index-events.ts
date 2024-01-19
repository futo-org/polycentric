import * as PersistenceDriver from '../persistence-driver';
import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import { HasIngest } from './has-ingest';

export function makeEventKey(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
): Uint8Array {
    return Util.concatBuffers([
        new Uint8Array(system.keyType.toBytesBE()),
        system.key,
        process.process,
        new Uint8Array(logicalClock.toBytesBE()),
    ]);
}

export class IndexEvents extends HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
    ) {
        super();

        this.level = registerSublevel('events');
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<Array<PersistenceDriver.BinaryUpdateLevel>> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const actions = [];

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteBody = Models.Delete.fromBuffer(event.content);

            actions.push(
                this.putTombstone(
                    event.system,
                    deleteBody.process,
                    deleteBody.logicalClock,
                    Models.signedEventToPointer(signedEvent),
                ),
            );
        }

        actions.push(
            this.putEvent(
                event.system,
                event.process,
                event.logicalClock,
                signedEvent,
            ),
        );

        return actions;
    }

    private putTombstone(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
        mutationPointer: Models.Pointer.Pointer,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeEventKey(system, process, logicalClock),
            value: Protocol.StorageTypeEvent.encode({
                mutationPointer: mutationPointer,
            }).finish(),
            sublevel: this.level,
        };
    }

    private putEvent(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
        signedEvent: Models.SignedEvent.SignedEvent,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeEventKey(system, process, logicalClock),
            value: Protocol.StorageTypeEvent.encode({
                event: signedEvent,
            }).finish(),
            sublevel: this.level,
        };
    }

    public async getSignedEventByKey(
        key: Uint8Array,
    ): Promise<Models.SignedEvent.SignedEvent | undefined> {
        const attempt = await PersistenceDriver.tryLoadKey(this.level, key);

        if (!attempt) {
            return undefined;
        } else {
            const storageEvent = Protocol.StorageTypeEvent.decode(attempt);

            if (storageEvent.event) {
                return Models.SignedEvent.fromProto(storageEvent.event);
            } else if (storageEvent.mutationPointer) {
                const mutationPointer = Models.Pointer.fromProto(
                    storageEvent.mutationPointer,
                );

                return await this.getSignedEvent(
                    mutationPointer.system,
                    mutationPointer.process,
                    mutationPointer.logicalClock,
                );
            } else {
                return undefined;
            }
        }
    }

    public async getSignedEvent(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
    ): Promise<Models.SignedEvent.SignedEvent | undefined> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.level,
            makeEventKey(system, process, logicalClock),
        );

        if (!attempt) {
            return undefined;
        } else {
            const storageEvent = Protocol.StorageTypeEvent.decode(attempt);

            if (storageEvent.event) {
                return Models.SignedEvent.fromProto(storageEvent.event);
            } else if (storageEvent.mutationPointer) {
                const mutationPointer = Models.Pointer.fromProto(
                    storageEvent.mutationPointer,
                );

                return await this.getSignedEvent(
                    mutationPointer.system,
                    mutationPointer.process,
                    mutationPointer.logicalClock,
                );
            } else {
                return undefined;
            }
        }
    }
}
