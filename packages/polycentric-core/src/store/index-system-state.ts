import * as PersistenceDriver from '../persistence-driver';
import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import { HasIngest } from './has-ingest';

export function makeSystemStateKey(
    system: Models.PublicKey.PublicKey,
): Uint8Array {
    return Util.concatBuffers([
        new Uint8Array(system.keyType.toBytesBE()),
        system.key,
    ]);
}

function updateSystemState(
    state: Models.Storage.StorageTypeSystemState,
    event: Models.Event.Event,
): void {
    {
        const lwwElement = event.lwwElement;

        if (lwwElement) {
            let found: Protocol.StorageTypeCRDTItem | undefined = undefined;

            for (const item of state.crdtItems) {
                if (item.contentType.equals(event.contentType)) {
                    found = item;
                    break;
                }
            }

            if (found && found.unixMilliseconds < lwwElement.unixMilliseconds) {
                found.unixMilliseconds = lwwElement.unixMilliseconds;
                found.value = lwwElement.value;
            } else {
                state.crdtItems.push({
                    contentType: event.contentType,
                    value: lwwElement.value,
                    unixMilliseconds: lwwElement.unixMilliseconds,
                });
            }
        }
    }

    {
        let foundProcess = false;

        for (const rawProcess of state.processes) {
            if (
                Models.Process.equal(
                    Models.Process.fromProto(rawProcess),
                    event.process,
                )
            ) {
                foundProcess = true;
                break;
            }
        }

        if (!foundProcess) {
            state.processes.push(event.process);
        }
    }
}

export class IndexSystemState extends HasIngest {
    private readonly level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
    ) {
        super();

        this.level = registerSublevel('systemStates');
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<Array<PersistenceDriver.BinaryUpdateLevel>> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const state = await this.getSystemState(event.system);

        updateSystemState(state, event);

        return [await this.putSystemState(event.system, state)];
    }

    public async getSystemState(
        system: Models.PublicKey.PublicKey,
    ): Promise<Models.Storage.StorageTypeSystemState> {
        const attempt = await PersistenceDriver.tryLoadKey(
            this.level,
            makeSystemStateKey(system),
        );

        if (attempt === undefined) {
            return Models.Storage.storageTypeSystemStateFromProto({
                crdtItems: [],
                processes: [],
            });
        } else {
            return Models.Storage.storageTypeSystemStateFromBuffer(attempt);
        }
    }

    private putSystemState(
        system: Models.PublicKey.PublicKey,
        state: Models.Storage.StorageTypeSystemState,
    ): PersistenceDriver.BinaryPutLevel {
        return {
            type: 'put',
            key: makeSystemStateKey(system),
            value: Protocol.StorageTypeSystemState.encode(state).finish(),
            sublevel: this.level,
        };
    }
}
