import Long from 'long';
import * as Base64 from '@borderless/base64';

import * as Util from './util';
import * as Models from './models';
import * as Protocol from './protocol';
import * as PersistenceDriver from './persistence-driver';

const PROCESS_SECRET_KEY: Uint8Array = Util.encodeText('PROCESS_SECRET');

export const MIN_8BYTE_KEY = new Uint8Array(8).fill(0);
export const MAX_8BYTE_KEY = new Uint8Array(8).fill(255);

export const MAX_16BYTE_KEY = new Uint8Array(16).fill(255);

export const MIN_32BYTE_KEY = new Uint8Array(32).fill(0);
export const MAX_32BYTE_KEY = new Uint8Array(32).fill(255);

export function makeSystemStateKey(
    system: Models.PublicKey.PublicKey,
): Uint8Array {
    return Util.concatBuffers([
        new Uint8Array(system.keyType.toBytesBE()),
        system.key,
    ]);
}

function makeProcessStateKey(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
): Uint8Array {
    return Util.encodeText(
        system.keyType.toString() +
            Base64.encode(system.key) +
            Base64.encode(process.process),
    );
}

function makeEventKey(
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

export class CRDTElementSetIndex {
    private _level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(level: PersistenceDriver.BinaryAbstractSubLevel) {
        this._level = level;
    }

    private makeKey(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        operation: Protocol.LWWElementSet_Operation,
        value: Uint8Array | undefined,
    ): Uint8Array {
        const buffers = [
            Protocol.PublicKey.encode(system).finish(),
            new Uint8Array(contentType.toBytesBE()),
            new Uint8Array([operation]),
        ];

        if (value) {
            buffers.push(value);
        }

        return Util.concatBuffers(buffers);
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
        event: Models.Event.Event,
    ): Promise<Array<PersistenceDriver.BinaryUpdateLevel>> {
        if (event.lwwElementSet === undefined) {
            return [];
        }

        const addKey = this.makeKey(
            event.system,
            event.contentType,
            Protocol.LWWElementSet_Operation.ADD,
            event.lwwElementSet.value,
        );

        const removeKey = this.makeKey(
            event.system,
            event.contentType,
            Protocol.LWWElementSet_Operation.REMOVE,
            event.lwwElementSet.value,
        );

        const potentialExistingAdd = await PersistenceDriver.tryLoadKey(
            this._level,
            addKey,
        );

        const potentialExistingRemove = await PersistenceDriver.tryLoadKey(
            this._level,
            removeKey,
        );

        if (potentialExistingAdd && potentialExistingRemove) {
            throw new Error('CRDTElementSetIndex invariant violated');
        }

        const potentialExisting =
            potentialExistingAdd ?? potentialExistingRemove;

        const parsedPotentialExisting = potentialExisting
            ? Long.fromBytesBE(Array.from(potentialExisting))
            : undefined;

        if (
            parsedPotentialExisting === undefined ||
            parsedPotentialExisting.lessThan(
                event.lwwElementSet.unixMilliseconds,
            )
        ) {
            const key =
                event.lwwElementSet.operation ===
                Protocol.LWWElementSet_Operation.ADD
                    ? addKey
                    : removeKey;

            const operations: Array<PersistenceDriver.BinaryUpdateLevel> = [];

            operations.push({
                type: 'put',
                key: key,
                value: new Uint8Array(
                    event.lwwElementSet.unixMilliseconds.toBytesBE(),
                ),
                sublevel: this._level,
            });

            let keyToRemove: Uint8Array | undefined = undefined;

            if (
                potentialExistingAdd &&
                event.lwwElementSet.operation ===
                    Protocol.LWWElementSet_Operation.REMOVE
            ) {
                keyToRemove = addKey;
            } else if (
                potentialExistingRemove &&
                event.lwwElementSet.operation ===
                    Protocol.LWWElementSet_Operation.ADD
            ) {
                keyToRemove = removeKey;
            }

            if (keyToRemove) {
                operations.push({
                    type: 'del',
                    key: keyToRemove,
                    sublevel: this._level,
                });
            }

            return operations;
        }

        return [];
    }

    public async query(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        value: Uint8Array | undefined,
        limit: number,
    ): Promise<Array<Uint8Array>> {
        const suffix = this.makeKey(
            system,
            contentType,
            Protocol.LWWElementSet_Operation.ADD,
            undefined,
        );

        const key = this.makeKey(
            system,
            contentType,
            Protocol.LWWElementSet_Operation.ADD,
            value,
        );

        const rows = await this._level
            .iterator({
                gte: key,
                limit: value ? limit + 1 : limit,
            })
            .all();

        let result = [];

        for (const [k, value] of rows) {
            if (!Util.bufferSuffixMatch(k, suffix)) {
                continue;
            }

            result.push(k.slice(suffix.length));
        }

        return result;
    }
}

export class OpinionIndex {
    private _level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(level: PersistenceDriver.BinaryAbstractSubLevel) {
        this._level = level;
    }

    private makeKey(
        system: Models.PublicKey.PublicKey,
        subject: Protocol.Reference,
    ): Uint8Array {
        return Util.concatBuffers([
            Protocol.PublicKey.encode(system).finish(),
            Protocol.Reference.encode(subject).finish(),
        ]);
    }

    public async getRawWithKey(
        key: Uint8Array,
    ): Promise<Protocol.LWWElement | undefined> {
        const attempt = await PersistenceDriver.tryLoadKey(this._level, key);

        if (attempt) {
            return Protocol.LWWElement.decode(attempt);
        } else {
            return undefined;
        }
    }

    public async put(
        system: Models.PublicKey.PublicKey,
        subject: Protocol.Reference,
        lwwElement: Protocol.LWWElement,
    ): Promise<PersistenceDriver.BinaryPutLevel | undefined> {
        const key = this.makeKey(system, subject);

        const existing = await this.getRawWithKey(key);

        if (
            existing &&
            (existing.unixMilliseconds.greaterThan(
                lwwElement.unixMilliseconds,
            ) ||
                Util.buffersEqual(existing.value, lwwElement.value))
        ) {
            return undefined;
        }

        return {
            type: 'put',
            key: key,
            value: Protocol.LWWElement.encode(lwwElement).finish(),
            sublevel: this._level,
        };
    }

    public async get(
        system: Models.PublicKey.PublicKey,
        subject: Protocol.Reference,
    ): Promise<Models.Opinion.Opinion> {
        const attempt = await this.getRawWithKey(this.makeKey(system, subject));

        if (attempt) {
            return attempt.value as Models.Opinion.Opinion;
        } else {
            return Models.Opinion.OpinionNeutral;
        }
    }
}

export class Store {
    level: PersistenceDriver.BinaryAbstractLevel;
    levelSystemStates: PersistenceDriver.BinaryAbstractSubLevel;
    levelProcessStates: PersistenceDriver.BinaryAbstractSubLevel;
    levelEvents: PersistenceDriver.BinaryAbstractSubLevel;
    levelIndexSystemContentTypeUnixMillisecondsProcess: PersistenceDriver.BinaryAbstractSubLevel;
    opinionIndex: OpinionIndex;
    crdtElementSetIndex: CRDTElementSetIndex;

    constructor(level: PersistenceDriver.BinaryAbstractLevel) {
        this.level = level;

        this.levelSystemStates = this.level.sublevel('systemStates', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as PersistenceDriver.BinaryAbstractSubLevel;

        this.levelProcessStates = this.level.sublevel('processStates', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as PersistenceDriver.BinaryAbstractSubLevel;

        this.levelEvents = this.level.sublevel('events', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as PersistenceDriver.BinaryAbstractSubLevel;

        this.levelIndexSystemContentTypeUnixMillisecondsProcess =
            this.level.sublevel(
                'indexSystemContentTypeUnixMillisecondsProcess',
                {
                    keyEncoding: 'buffer',
                    valueEncoding: 'buffer',
                },
            ) as PersistenceDriver.BinaryAbstractSubLevel;

        this.opinionIndex = new OpinionIndex(
            this.level.sublevel('opinions', {
                keyEncoding: 'buffer',
                valueEncoding: 'buffer',
            }) as PersistenceDriver.BinaryAbstractSubLevel,
        );

        this.crdtElementSetIndex = new CRDTElementSetIndex(
            this.level.sublevel('indexCRDTElementSet', {
                keyEncoding: 'buffer',
                valueEncoding: 'buffer',
            }) as PersistenceDriver.BinaryAbstractSubLevel,
        );
    }

    public async setProcessSecret(
        processSecret: Models.ProcessSecret.ProcessSecret,
    ): Promise<void> {
        await this.level.put(
            PROCESS_SECRET_KEY,
            Protocol.StorageTypeProcessSecret.encode(processSecret).finish(),
        );
    }

    public async getProcessSecret(): Promise<Models.ProcessSecret.ProcessSecret> {
        return Models.ProcessSecret.fromProto(
            Protocol.StorageTypeProcessSecret.decode(
                await this.level.get(PROCESS_SECRET_KEY),
            ),
        );
    }

    public async getProcessState(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
    ): Promise<Protocol.StorageTypeProcessState> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.levelProcessStates,
            makeProcessStateKey(system, process),
        );

        if (attempt === undefined) {
            return {
                logicalClock: new Long(0),
                ranges: [],
                indices: { indices: [] },
            };
        } else {
            return Protocol.StorageTypeProcessState.decode(attempt);
        }
    }

    public putProcessState(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        state: Protocol.StorageTypeProcessState,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeProcessStateKey(system, process),
            value: Protocol.StorageTypeProcessState.encode(state).finish(),
            sublevel: this.levelProcessStates,
        };
    }

    public async getSystemState(
        system: Models.PublicKey.PublicKey,
    ): Promise<Protocol.StorageTypeSystemState> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.levelSystemStates,
            makeSystemStateKey(system),
        );

        if (attempt === undefined) {
            return {
                crdtItems: [],
                processes: [],
            };
        } else {
            return Protocol.StorageTypeSystemState.decode(attempt);
        }
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
            sublevel: this.levelIndexSystemContentTypeUnixMillisecondsProcess,
        };
    }

    public putIndexSystemContentTypeUnixMillisecondsProcess(
        event: Models.Event.Event,
    ): PersistenceDriver.BinaryPutLevel {
        if (event.unixMilliseconds === undefined) {
            throw Error('expected unixMilliseconds');
        }

        const indexKey = indexSystemContentTypeUnixMillisecondsProcessKey(
            event.system,
            event.contentType,
            event.unixMilliseconds,
            event.process,
        );

        const eventKey = makeEventKey(
            event.system,
            event.process,
            event.logicalClock,
        );

        return {
            type: 'put',
            key: indexKey,
            value: eventKey,
            sublevel: this.levelIndexSystemContentTypeUnixMillisecondsProcess,
        };
    }

    public async queryIndexSystemContentTypeUnixMillisecondsProcess(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        unixMilliseconds: Long | undefined,
        limit: number,
    ): Promise<Array<Protocol.SignedEvent>> {
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

        const rows =
            await this.levelIndexSystemContentTypeUnixMillisecondsProcess
                .iterator({
                    lt: key,
                    limit: unixMilliseconds ? limit + 1 : limit,
                    reverse: true,
                })
                .all();

        let result = [];

        for (const [k, value] of rows) {
            if (!Util.bufferSuffixMatch(k, suffix)) {
                continue;
            }

            const signedEvent = await this.getSignedEventByKey(value);

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

    public putSystemState(
        system: Models.PublicKey.PublicKey,
        state: Protocol.StorageTypeSystemState,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeSystemStateKey(system),
            value: Protocol.StorageTypeSystemState.encode(state).finish(),
            sublevel: this.levelSystemStates,
        };
    }

    public putTombstone(
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
            sublevel: this.levelEvents,
        };
    }

    public putEvent(
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
            sublevel: this.levelEvents,
        };
    }

    public async getSignedEventByKey(
        key: Uint8Array,
    ): Promise<Protocol.SignedEvent | undefined> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.levelEvents,
            key,
        );

        if (!attempt) {
            return undefined;
        } else {
            const storageEvent = Protocol.StorageTypeEvent.decode(attempt);

            if (storageEvent.event) {
                return storageEvent.event;
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
    ): Promise<Protocol.SignedEvent | undefined> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.levelEvents,
            makeEventKey(system, process, logicalClock),
        );

        if (!attempt) {
            return undefined;
        } else {
            const storageEvent = Protocol.StorageTypeEvent.decode(attempt);

            if (storageEvent.event) {
                return storageEvent.event;
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
