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
            return Protocol.StorageTypeEvent.decode(attempt).event;
        }
    }
}
