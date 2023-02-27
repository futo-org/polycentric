import Long from 'long';
import * as Base64 from '@borderless/base64';

import * as Util from './util';
import * as Models from './models';
import * as Protocol from './protocol';
import * as PersistenceDriver from './persistence-driver';

const PROCESS_SECRET_KEY: Uint8Array = Util.encodeText('PROCESS_SECRET');

function makeSystemStateKey(system: Models.PublicKey): Uint8Array {
    return Util.encodeText(
        system.keyType().toString() + Base64.encode(system.key()),
    );
}

function makeProcessStateKey(
    system: Models.PublicKey,
    process: Models.Process,
): Uint8Array {
    return Util.encodeText(
        system.keyType().toString() +
            Base64.encode(system.key()) +
            Base64.encode(process.process()),
    );
}

function makeEventKey(
    system: Models.PublicKey,
    process: Models.Process,
    logicalClock: Long,
): Uint8Array {
    return Util.encodeText(
        system.keyType().toString() +
            Base64.encode(system.key()) +
            Base64.encode(process.process()) +
            logicalClock.toString(),
    );
}

export class Store {
    level: PersistenceDriver.BinaryAbstractLevel;
    levelSystemStates: PersistenceDriver.BinaryAbstractSubLevel;
    levelProcessStates: PersistenceDriver.BinaryAbstractSubLevel;
    levelEvents: PersistenceDriver.BinaryAbstractSubLevel;
    levelIndexClaims: PersistenceDriver.BinaryAbstractSubLevel;

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

        this.levelIndexClaims = this.level.sublevel('indexClaims', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as PersistenceDriver.BinaryAbstractSubLevel;
    }

    public async setProcessSecret(
        processSecret: Models.ProcessSecret,
    ): Promise<void> {
        await this.level.put(
            PROCESS_SECRET_KEY,
            Protocol.StorageTypeProcessSecret.encode(
                Models.processSecretToProto(processSecret),
            ).finish(),
        );
    }

    public async getProcessSecret(): Promise<Models.ProcessSecret> {
        return Models.processSecretFromProto(
            Protocol.StorageTypeProcessSecret.decode(
                await this.level.get(PROCESS_SECRET_KEY),
            ),
        );
    }

    public async getProcessState(
        system: Models.PublicKey,
        process: Models.Process,
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
        system: Models.PublicKey,
        process: Models.Process,
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
        system: Models.PublicKey,
    ): Promise<Protocol.StorageTypeSystemState> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.levelSystemStates,
            makeSystemStateKey(system),
        );

        if (attempt === undefined) {
            return {
                crdtItems: [],
                crdtSetItems: [],
                processes: [],
            };
        } else {
            return Protocol.StorageTypeSystemState.decode(attempt);
        }
    }

    public deleteIndexClaim(
        system: Models.PublicKey,
        process: Models.Process,
        logicalClock: Long,
    ): PersistenceDriver.BinaryDelLevel {
        const key = makeEventKey(system, process, logicalClock);

        return {
            type: 'del',
            key: key,
            sublevel: this.levelIndexClaims,
        };
    }

    public putIndexClaim(
        system: Models.PublicKey,
        process: Models.Process,
        logicalClock: Long,
    ): PersistenceDriver.BinaryPutLevel {
        const key = makeEventKey(system, process, logicalClock);

        return {
            type: 'put',
            key: key,
            value: new Uint8Array(),
            sublevel: this.levelIndexClaims,
        };
    }

    public async queryClaimIndex(
        system: Models.PublicKey,
        limit: number,
        iterator: Uint8Array | undefined,
    ): Promise<[Array<Protocol.SignedEvent>, Uint8Array | undefined]> {
        const key = iterator ? iterator : makeSystemStateKey(system);

        const indices = await this.levelIndexClaims
            .iterator({
                lt: key,
                limit: limit,
            })
            .all();

        let position = undefined;
        let result = [];

        for (const [k, v] of indices) {
            const signedEvent = await this.getSignedEventByKey(k);

            if (signedEvent) {
                result.push(signedEvent);
            }

            position = k;
        }

        return [result, position];
    }

    public putSystemState(
        system: Models.PublicKey,
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
        system: Models.PublicKey,
        process: Models.Process,
        logicalClock: Long,
        mutationPointer: Models.Pointer,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeEventKey(system, process, logicalClock),
            value: Protocol.StorageTypeEvent.encode({
                mutationPointer: Models.pointerToProto(mutationPointer),
            }).finish(),
            sublevel: this.levelEvents,
        };
    }

    public putEvent(
        system: Models.PublicKey,
        process: Models.Process,
        logicalClock: Long,
        signedEvent: Models.SignedEvent,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeEventKey(system, process, logicalClock),
            value: Protocol.StorageTypeEvent.encode({
                event: Models.signedEventToProto(signedEvent),
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
                const mutationPointer = Models.pointerFromProto(
                    storageEvent.mutationPointer,
                );

                return await this.getSignedEvent(
                    mutationPointer.system(),
                    mutationPointer.process(),
                    mutationPointer.logicalClock(),
                );
            } else {
                return undefined;
            }
        }
    }

    public async getSignedEvent(
        system: Models.PublicKey,
        process: Models.Process,
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
                const mutationPointer = Models.pointerFromProto(
                    storageEvent.mutationPointer,
                );

                return await this.getSignedEvent(
                    mutationPointer.system(),
                    mutationPointer.process(),
                    mutationPointer.logicalClock(),
                );
            } else {
                return undefined;
            }
        }
    }
}
