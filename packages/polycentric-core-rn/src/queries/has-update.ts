import * as Models from '../models';

export interface HasUpdate {
  update(signedEvent: Models.SignedEvent.SignedEvent): void;
}
