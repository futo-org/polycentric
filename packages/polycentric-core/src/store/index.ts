import * as Models from '../models';
import * as PersistenceDriver from '../persistence-driver';
import * as Protocol from '../protocol';
import * as Util from '../util';

import { HasIngest } from './has-ingest';
import { IndexCRDTElementSet } from './index-crdt-element-set';
import { IndexEvents } from './index-events';
import { IndexEventsForSystemByTime } from './index-events-for-system-by-time';
import { IndexFeed } from './index-feed';
import { IndexOpinion } from './index-opinion';
import { IndexProcessState } from './index-process-state';
import { IndexSystemProcessContentTypeClock } from './index-system-process-content-type-clock';
import { IndexSystemState } from './index-system-state';

export * as IndexEvents from './index-events';
export * as IndexFeed from './index-feed';

const PROCESS_SECRET_KEY: Uint8Array = Util.encodeText('PROCESS_SECRET');

export const MIN_8BYTE_KEY = new Uint8Array(8).fill(0);
export const MAX_8BYTE_KEY = new Uint8Array(8).fill(255);

export const MAX_16BYTE_KEY = new Uint8Array(16).fill(255);

export const MIN_32BYTE_KEY = new Uint8Array(32).fill(0);
export const MAX_32BYTE_KEY = new Uint8Array(32).fill(255);

export function makeSystemStateKey(
    system: Models.PublicKey.PublicKey,
): Uint8Array {
    return Util.concatBuffers([
        new Uint8Array(system.keyType.toBytesBE()),
        system.key,
    ]);
}

export class Store {
    private readonly level: PersistenceDriver.BinaryAbstractLevel;
    readonly indexEvents: IndexEvents;
    readonly indexSystemStates: IndexSystemState;
    readonly indexProcessStates: IndexProcessState;
    readonly indexEventsForSystemByTime: IndexEventsForSystemByTime;
    readonly indexOpinion: IndexOpinion;
    readonly indexCRDTElementSet: IndexCRDTElementSet;
    readonly indexFeed: IndexFeed;
    readonly indexSystemProcessContentTypeLogicalClock: IndexSystemProcessContentTypeClock;

    private readonly stages: readonly HasIngest[];

    system: Models.PublicKey.PublicKey | undefined;

    constructor(level: PersistenceDriver.BinaryAbstractLevel) {
        this.level = level;

        const sublevels = new Set<string>();

        const registerSublevel = (prefix: string) => {
            if (sublevels.has(prefix)) {
                throw Error('conflicting sublevel prefix');
            }

            const sublevel = this.level.sublevel(prefix, {
                keyEncoding: PersistenceDriver.deepCopyTranscoder(),
                valueEncoding: PersistenceDriver.deepCopyTranscoder(),
            }) as PersistenceDriver.BinaryAbstractSubLevel;

            sublevels.add(prefix);

            return sublevel;
        };

        this.indexEvents = new IndexEvents(registerSublevel);
        this.indexSystemStates = new IndexSystemState(registerSublevel);
        this.indexProcessStates = new IndexProcessState(registerSublevel);
        this.indexEventsForSystemByTime = new IndexEventsForSystemByTime(
            registerSublevel,
            this.indexEvents,
        );
        this.indexOpinion = new IndexOpinion(registerSublevel);
        this.indexCRDTElementSet = new IndexCRDTElementSet(registerSublevel);
        this.indexFeed = new IndexFeed(this, registerSublevel);
        this.indexSystemProcessContentTypeLogicalClock =
            new IndexSystemProcessContentTypeClock(
                registerSublevel,
                this.indexEvents,
            );

        this.system = undefined;

        this.stages = [
            this.indexEvents,
            this.indexSystemStates,
            this.indexProcessStates,
            this.indexEventsForSystemByTime,
            this.indexOpinion,
            this.indexCRDTElementSet,
            this.indexFeed,
            this.indexSystemProcessContentTypeLogicalClock,
        ];
    }

    public async ingest(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): Promise<void> {
        const actions: PersistenceDriver.BinaryUpdateLevel[] = [];

        for (const stage of this.stages) {
            actions.push(...(await stage.ingest(signedEvent)));
        }

        await this.level.batch(actions);
    }

    public async setProcessSecret(
        processSecret: Models.ProcessSecret.ProcessSecret,
    ): Promise<void> {
        await this.level.put(
            PROCESS_SECRET_KEY,
            Protocol.StorageTypeProcessSecret.encode(processSecret).finish(),
        );
    }

    public async getProcessSecret(): Promise<Models.ProcessSecret.ProcessSecret> {
        return Models.ProcessSecret.fromProto(
            Protocol.StorageTypeProcessSecret.decode(
                await this.level.get(PROCESS_SECRET_KEY),
            ),
        );
    }

    public async getEventAcks(): Promise<Record<string, string[]>> {
        return this.indexEvents.getEventAcks();
    }

    public async saveEventAcks(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
        servers: string[],
    ): Promise<void> {
        await this.indexEvents.saveEventAcks(
            system,
            process,
            logicalClock,
            servers,
        );
    }
}
