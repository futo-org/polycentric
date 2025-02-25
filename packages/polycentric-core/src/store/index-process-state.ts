import * as Base64 from '@borderless/base64';
import Long from 'long';

import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';
import * as Protocol from '../protocol';
import * as Ranges from '../ranges';
import * as Util from '../util';
import { HasIngest } from './has-ingest';

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

export class IndexProcessState implements HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
    ) {
        this.level = registerSublevel('processStates');
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const actions: PersistenceDriver.BinaryUpdateLevel[] = [];

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteBody = Models.Delete.fromBuffer(event.content);

            if (!Models.Process.equal(event.process, deleteBody.process)) {
                const deleteProcessState = await this.getProcessState(
                    event.system,
                    deleteBody.process,
                );

                if (
                    Ranges.insert(
                        deleteProcessState.ranges,
                        deleteBody.logicalClock,
                    )
                ) {
                    actions.push(
                        this.putProcessState(
                            event.system,
                            deleteBody.process,
                            deleteProcessState,
                        ),
                    );
                }
            }
        }

        const processState = await this.getProcessState(
            event.system,
            event.process,
        );

        if (updateProcessState(processState, event)) {
            actions.push(
                this.putProcessState(event.system, event.process, processState),
            );
        }

        return actions;
    }

    public async getProcessState(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
    ): Promise<Models.Storage.StorageTypeProcessState> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.level,
            makeProcessStateKey(system, process),
        );

        if (attempt === undefined) {
            return Models.Storage.storageTypeProcessStateFromProto({
                logicalClock: new Long(0),
                ranges: [],
                indices: { indices: [] },
            });
        } else {
            return Models.Storage.storageTypeProcessStateFromBuffer(attempt);
        }
    }

    private putProcessState(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        state: Models.Storage.StorageTypeProcessState,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeProcessStateKey(system, process),
            value: Protocol.StorageTypeProcessState.encode(state).finish(),
            sublevel: this.level,
        };
    }
}

function updateProcessState(
    state: Models.Storage.StorageTypeProcessState,
    event: Models.Event.Event,
): boolean {
    let mutated = false;

    if (event.logicalClock.compare(state.logicalClock) === 1) {
        state.logicalClock = event.logicalClock;

        mutated = true;
    }

    mutated = Ranges.insert(state.ranges, event.logicalClock) || mutated;

    {
        let foundIndex = false;

        for (const index of state.indices.indices) {
            if (index.indexType.equals(event.contentType)) {
                foundIndex = true;

                if (event.logicalClock.compare(index.logicalClock) === 1) {
                    index.logicalClock = event.logicalClock;
                    mutated = true;
                }
            }
        }

        if (!foundIndex) {
            state.indices.indices.push({
                indexType: event.contentType,
                logicalClock: event.logicalClock,
            });

            mutated = true;
        }
    }

    return mutated;
}
