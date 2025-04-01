import Long from 'long';
import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';
import * as Protocol from '../protocol';
import * as Util from '../util';
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

export class IndexEvents implements HasIngest {
  private readonly level: PersistenceDriver.BinaryAbstractSubLevel;
  private readonly acksLevel: PersistenceDriver.BinaryAbstractSubLevel;
  private readonly ACKS_KEY = new Uint8Array([0]);

  constructor(
    registerSublevel: (
      prefix: string,
    ) => PersistenceDriver.BinaryAbstractSubLevel,
  ) {
    this.level = registerSublevel('events');
    this.acksLevel = registerSublevel('event_acks');
  }

  public async getEventAcks(): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};

    try {
      const iterator = this.acksLevel.iterator();

      for await (const [key, value] of iterator) {
        try {
          if (key.length === 1 && key[0] === 0) continue;

          const servers = JSON.parse(
            new TextDecoder().decode(value),
          ) as string[];

          if (key.length > 1 && key[0] === 1) {
            if (servers.length > 0) {
              const lastByte = key[key.length - 1];
              const simpleKey = `event_${lastByte.toString()}_${Date.now().toString()}`;
              result[simpleKey] = servers;
            }
          }

          const keyStr = new TextDecoder().decode(key);
          if (keyStr.startsWith('event_') && keyStr.includes('_fixed')) {
            const logicalClockStr = keyStr.split('_')[1];
            if (logicalClockStr) {
              result[`event_${logicalClockStr}_stable`] = servers;
            }
          }
        } catch (e) {
          console.error('Error processing ack key-value:', e);
        }
      }
    } catch (e) {
      console.error('Error reading acks:', e);
    }

    return result;
  }

  public async saveEventAcks(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
    servers: string[],
  ): Promise<void> {
    if (servers.length === 0) {
      return;
    }

    const ackKey = new Uint8Array([
      1,
      ...Array.from(system.key.slice(0, 8)),
      ...Array.from(process.process.slice(0, 8)),
      ...new Uint8Array(logicalClock.toBytesBE().slice(0, 8)),
    ]);

    await this.acksLevel.put(
      ackKey,
      new TextEncoder().encode(JSON.stringify(servers)),
    );

    const logicalClockStr = logicalClock.toString();
    const stringKey = new TextEncoder().encode(
      `event_${logicalClockStr}_fixed`,
    );

    await this.acksLevel.put(
      stringKey,
      new TextEncoder().encode(JSON.stringify(servers)),
    );
  }

  /* eslint @typescript-eslint/require-await: 0 */
  public async ingest(
    signedEvent: Models.SignedEvent.SignedEvent,
  ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
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
      const storageEvent = Models.Storage.storageTypeEventFromBuffer(attempt);

      if (storageEvent.event) {
        return storageEvent.event;
      } else if (storageEvent.mutationPointer) {
        const mutationPointer = storageEvent.mutationPointer;

        return await this.getSignedEvent(
          mutationPointer.system,
          mutationPointer.process,
          mutationPointer.logicalClock,
        );
      } else {
        throw Error('impossible');
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
      const storageEvent = Models.Storage.storageTypeEventFromBuffer(attempt);

      if (storageEvent.event) {
        return storageEvent.event;
      } else if (storageEvent.mutationPointer) {
        const mutationPointer = storageEvent.mutationPointer;

        return await this.getSignedEvent(
          mutationPointer.system,
          mutationPointer.process,
          mutationPointer.logicalClock,
        );
      } else {
        throw Error('impossible');
      }
    }
  }
}
