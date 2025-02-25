import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';
import * as Protocol from '../protocol';
import * as Util from '../util';
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
): boolean {
  let mutated = false;

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

      if (found) {
        if (found.unixMilliseconds < lwwElement.unixMilliseconds) {
          found.unixMilliseconds = lwwElement.unixMilliseconds;
          found.value = lwwElement.value;
        }
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
        mutated = true;
        break;
      }
    }

    if (!foundProcess) {
      state.processes.push(event.process);
      mutated = true;
    }
  }

  return mutated;
}

export class IndexSystemState implements HasIngest {
  private readonly level: PersistenceDriver.BinaryAbstractSubLevel;

  constructor(
    registerSublevel: (
      prefix: string,
    ) => PersistenceDriver.BinaryAbstractSubLevel,
  ) {
    this.level = registerSublevel('systemStates');
  }

  public async ingest(
    signedEvent: Models.SignedEvent.SignedEvent,
  ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
    const event = Models.Event.fromBuffer(signedEvent.event);

    const state = await this.getSystemState(event.system);

    if (updateSystemState(state, event)) {
      return [this.putSystemState(event.system, state)];
    } else {
      return [];
    }
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
