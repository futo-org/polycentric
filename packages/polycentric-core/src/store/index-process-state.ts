import Long from 'long';
import * as Base64 from '@borderless/base64';

import * as PersistenceDriver from '../persistence-driver';
import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import * as Ranges from '../ranges';
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

export class IndexProcessState extends HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
    ) {
        super();

        this.level = registerSublevel('processStates');
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<Array<PersistenceDriver.BinaryUpdateLevel>> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const actions: Array<PersistenceDriver.BinaryUpdateLevel> = [];

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteBody = Models.Delete.fromBuffer(event.content);

            if (!Models.Process.equal(event.process, deleteBody.process)) {
                const deleteProcessState = await this.getProcessState(
                    event.system,
                    deleteBody.process,
                );

                Ranges.insert(
                    deleteProcessState.ranges,
                    deleteBody.logicalClock,
                );

                actions.push(
                    this.putProcessState(
                        event.system,
                        deleteBody.process,
                        deleteProcessState,
                    ),
                );
            }
        }

        const processState = await this.getProcessState(
            event.system,
            event.process,
        );

        updateProcessState(processState, event);

        actions.push(
            this.putProcessState(event.system, event.process, processState),
        );

        return actions;
    }

    public async getProcessState(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
    ): Promise<Protocol.StorageTypeProcessState> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.level,
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

    private putProcessState(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        state: Protocol.StorageTypeProcessState,
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
    state: Protocol.StorageTypeProcessState,
    event: Models.Event.Event,
): void {
    if (event.logicalClock.compare(state.logicalClock) === 1) {
        state.logicalClock = event.logicalClock;
    }

    if (state.indices === undefined) {
        throw new Error('expected indices');
    }

    Ranges.insert(state.ranges, event.logicalClock);

    {
        let foundIndex = false;

        for (const index of state.indices.indices) {
            if (index.indexType.equals(event.contentType)) {
                foundIndex = true;

                if (event.logicalClock.compare(index.logicalClock) === 1) {
                    index.logicalClock = event.logicalClock;
                }
            }
        }

        if (!foundIndex) {
            state.indices.indices.push({
                indexType: event.contentType,
                logicalClock: event.logicalClock,
            });
        }
    }
}
