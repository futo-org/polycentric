import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';

export interface HasIngest {
  ingest(
    signedEvent: Models.SignedEvent.SignedEvent,
  ): Promise<PersistenceDriver.BinaryUpdateLevel[]>;
}
