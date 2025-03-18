import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';
import * as Protocol from '../protocol';
import * as Util from '../util';
import { HasIngest } from './has-ingest';

export class IndexOpinion implements HasIngest {
  private _level: PersistenceDriver.BinaryAbstractSubLevel;

  constructor(
    registerSublevel: (
      prefix: string,
    ) => PersistenceDriver.BinaryAbstractSubLevel,
  ) {
    this._level = registerSublevel('opinions');
  }

  public async ingest(
    signedEvent: Models.SignedEvent.SignedEvent,
  ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
    const event = Models.Event.fromBuffer(signedEvent.event);

    if (
      event.contentType.equals(Models.ContentType.ContentTypeOpinion) &&
      event.references.length === 1 &&
      event.lwwElement
    ) {
      const system = event.system;
      const subject = event.references[0];
      const lwwElement = event.lwwElement;

      const key = this.makeKey(system, subject);

      const existing = await this.getRawWithKey(key);

      if (
        existing &&
        (existing.unixMilliseconds.greaterThan(lwwElement.unixMilliseconds) ||
          Util.buffersEqual(existing.value, lwwElement.value))
      ) {
        return [];
      }

      return [
        {
          type: 'put',
          key: key,
          value: Protocol.LWWElement.encode(lwwElement).finish(),
          sublevel: this._level,
        },
      ];
    } else {
      return [];
    }
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
