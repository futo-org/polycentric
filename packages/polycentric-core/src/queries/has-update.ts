import * as Models from '../models';

export abstract class HasUpdate {
    public abstract update(signedEvent: Models.SignedEvent.SignedEvent): void;
}
