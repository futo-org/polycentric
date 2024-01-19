import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';

export abstract class HasIngest {
    public abstract ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<Array<PersistenceDriver.BinaryUpdateLevel>>;
}
