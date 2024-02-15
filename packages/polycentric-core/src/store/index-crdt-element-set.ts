import Long from 'long';

import * as PersistenceDriver from '../persistence-driver';
import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import { HasIngest } from './has-ingest';

export class IndexCRDTElementSet extends HasIngest {
    private _level: PersistenceDriver.BinaryAbstractSubLevel;

    constructor(
        registerSublevel: (
            prefix: string,
        ) => PersistenceDriver.BinaryAbstractSubLevel,
    ) {
        super();

        this._level = registerSublevel('indexCRDTElementSet');
    }

    private makeKey(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        operation: Protocol.LWWElementSet_Operation,
        value: Uint8Array | undefined,
    ): Uint8Array {
        const buffers = [
            Protocol.PublicKey.encode(system).finish(),
            new Uint8Array(contentType.toBytesBE()),
            new Uint8Array([operation]),
        ];

        if (value) {
            buffers.push(value);
        }

        return Util.concatBuffers(buffers);
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<PersistenceDriver.BinaryUpdateLevel[]> {
        const event = Models.Event.fromBuffer(signedEvent.event);

        if (event.lwwElementSet === undefined) {
            return [];
        }

        const addKey = this.makeKey(
            event.system,
            event.contentType,
            Protocol.LWWElementSet_Operation.ADD,
            event.lwwElementSet.value,
        );

        const removeKey = this.makeKey(
            event.system,
            event.contentType,
            Protocol.LWWElementSet_Operation.REMOVE,
            event.lwwElementSet.value,
        );

        const potentialExistingAdd = await PersistenceDriver.tryLoadKey(
            this._level,
            addKey,
        );

        const potentialExistingRemove = await PersistenceDriver.tryLoadKey(
            this._level,
            removeKey,
        );

        if (potentialExistingAdd && potentialExistingRemove) {
            throw new Error('CRDTElementSetIndex invariant violated');
        }

        const potentialExisting =
            potentialExistingAdd ?? potentialExistingRemove;

        const parsedPotentialExisting = potentialExisting
            ? Long.fromBytesBE(Array.from(potentialExisting))
            : undefined;

        if (
            parsedPotentialExisting === undefined ||
            parsedPotentialExisting.lessThan(
                event.lwwElementSet.unixMilliseconds,
            )
        ) {
            const key =
                event.lwwElementSet.operation ===
                Protocol.LWWElementSet_Operation.ADD
                    ? addKey
                    : removeKey;

            const operations: PersistenceDriver.BinaryUpdateLevel[] = [];

            operations.push({
                type: 'put',
                key: key,
                value: new Uint8Array(
                    event.lwwElementSet.unixMilliseconds.toBytesBE(),
                ),
                sublevel: this._level,
            });

            let keyToRemove: Uint8Array | undefined = undefined;

            if (
                potentialExistingAdd &&
                event.lwwElementSet.operation ===
                    Protocol.LWWElementSet_Operation.REMOVE
            ) {
                keyToRemove = addKey;
            } else if (
                potentialExistingRemove &&
                event.lwwElementSet.operation ===
                    Protocol.LWWElementSet_Operation.ADD
            ) {
                keyToRemove = removeKey;
            }

            if (keyToRemove) {
                operations.push({
                    type: 'del',
                    key: keyToRemove,
                    sublevel: this._level,
                });
            }

            return operations;
        }

        return [];
    }

    public async query(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        value: Uint8Array | undefined,
        limit: number,
    ): Promise<Uint8Array[]> {
        const suffix = this.makeKey(
            system,
            contentType,
            Protocol.LWWElementSet_Operation.ADD,
            undefined,
        );

        const key = this.makeKey(
            system,
            contentType,
            Protocol.LWWElementSet_Operation.ADD,
            value,
        );

        const rows = await this._level
            .iterator({
                gte: key,
                limit: value ? limit + 1 : limit,
            })
            .all();

        const result = [];

        for (const [k] of rows) {
            if (!Util.bufferSuffixMatch(k, suffix)) {
                continue;
            }

            result.push(k.slice(suffix.length));
        }

        return result;
    }

    public async queryIfAdded(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        value: Uint8Array,
    ): Promise<boolean> {
        const key = this.makeKey(
            system,
            contentType,
            Protocol.LWWElementSet_Operation.ADD,
            value,
        );

        const attempt = await PersistenceDriver.tryLoadKey(this._level, key);

        return attempt !== undefined;
    }
}
