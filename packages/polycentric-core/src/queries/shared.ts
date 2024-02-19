import * as Models from '../models';
import { HasUpdate } from './has-update';

export type UnregisterCallback = () => void;

export const DuplicatedCallbackError = new Error('duplicated callback');
export const ImpossibleError = new Error('impossible');

export interface LoadedBatch {
    readonly signedEvents: readonly Models.SignedEvent.SignedEvent[];
    readonly origin: HasUpdate;
}

export type OnLoadedBatch = (loadedBatch: LoadedBatch) => void;
