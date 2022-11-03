import * as Ed from '@noble/ed25519';
import * as AbstractLevel from 'abstract-level';
import AsyncLock from 'async-lock';
import Long from 'long';
import * as Base64 from '@borderless/base64';
import * as Lodash from 'lodash';

import * as Util from './Util';
import * as Protocol from './protocol';
import * as Crypto from './crypto';
import * as Synchronization from './synchronization';
import * as APIMethods from './APIMethods';

export type Listener = {
    key: string;
    callback: () => void;
};

export class DependencyContext {
    private _mutated: boolean;
    private _cleanup: boolean;
    private _handler: (() => void) | undefined;
    private _listeners: Array<Listener>;
    private _state: PolycentricState;
    private _listenerCallback: () => void;

    public constructor(state: PolycentricState) {
        this._mutated = false;
        this._cleanup = false;
        this._handler = undefined;
        this._listeners = new Array();
        this._state = state;

        const selfa = this;

        this._listenerCallback = Lodash.once(() => {
            selfa._mutated = true;

            if (selfa._handler !== undefined && selfa._cleanup !== true) {
                console.log('called dependency handler');
                selfa._handler();
            }
        });
    }

    public addDependency(pointer: Protocol.Pointer): void {
        const key = makeStorageTypeEventKey(
            pointer.publicKey,
            pointer.writerId,
            pointer.sequenceNumber,
        );

        this.addDependencyByKey(key);
    }

    public addDependencyByKey(buffer: Uint8Array): void {
        if (this._cleanup === true) {
            throw new Error('addDependency called after cleanup');
        }

        const key = Base64.encode(buffer);

        this._listeners.push({
            key: key,
            callback: this._listenerCallback,
        });

        waitOnEvent(this._state, key, this._listenerCallback);
    }

    public cleanup(): void {
        if (this._cleanup === true) {
            console.log('cleanup called after cleanup');
            return;
            // throw new Error("cleanup called after cleanup");
        }

        console.log('cancelled count', this._listeners.length);
        for (const listener of this._listeners) {
            cancelWaitOnEvent(this._state, listener.key, listener.callback);
        }

        this._cleanup = true;
    }

    public setHandler(callback: () => void): void {
        this._handler = callback;

        if (this._mutated === true) {
            console.log('mutation detected on set handler');

            this._handler();
        }
    }
}

export enum EventMessageType {
    Message,
    Profile,
    Follow,
    BlobMeta,
    BlobSection,
    Delete,
    Unknown,
}

export interface IIdentityState {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
    writerId: Uint8Array;
    sequenceNumber: number;
}

export type BinaryAbstractLevel = AbstractLevel.AbstractLevel<
    Uint8Array,
    Uint8Array,
    Uint8Array
>;

export enum StorageDriver {
    Memory = 'Memory',
    IndexedDB = 'IndexedDB',
    LevelDB = 'LevelDB',
}

export class PolycentricState {
    sync: Synchronization.SynchronizationState;
    identity: IIdentityState | undefined;
    autoSync: boolean;
    lock: AsyncLock;
    storageDriver: StorageDriver;

    level: BinaryAbstractLevel;
    levelEvents: BinaryAbstractLevel;
    levelRanges: BinaryAbstractLevel;
    levelFollowing: BinaryAbstractLevel;
    levelProfiles: BinaryAbstractLevel;
    levelIndexPostByTime: BinaryAbstractLevel;
    levelIndexPostByAuthorByTime: BinaryAbstractLevel;

    listeners: Map<string, Set<() => void>>;

    constructor(level: BinaryAbstractLevel, storageDriver: StorageDriver) {
        console.log('creating state');
        this.sync = new Synchronization.SynchronizationState();
        this.identity = undefined;
        this.autoSync = true;
        this.listeners = new Map();
        this.storageDriver = storageDriver;

        this.lock = new AsyncLock();

        this.level = level;

        this.levelEvents = this.level.sublevel('events', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as BinaryAbstractLevel;

        this.levelRanges = this.level.sublevel('ranges', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as BinaryAbstractLevel;

        this.levelFollowing = this.level.sublevel('following', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as BinaryAbstractLevel;

        this.levelProfiles = this.level.sublevel('profiles', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as BinaryAbstractLevel;

        this.levelIndexPostByTime = this.level.sublevel('indexPostByTime', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as BinaryAbstractLevel;

        this.levelIndexPostByAuthorByTime = this.level.sublevel(
            'indexPostByAuthorByTime',
            {
                keyEncoding: 'buffer',
                valueEncoding: 'buffer',
            },
        ) as BinaryAbstractLevel;

        this.level.setMaxListeners(10000);
    }
}

export function waitOnEvent(
    state: PolycentricState,
    key: string,
    cb: () => void,
) {
    let listenersForKey = state.listeners.get(key);

    if (listenersForKey === undefined) {
        listenersForKey = new Set();

        state.listeners.set(key, listenersForKey);
    }

    listenersForKey.add(cb);
}

export function cancelWaitOnEvent(
    state: PolycentricState,
    key: string,
    cb: () => void,
) {
    let listenersForKey = state.listeners.get(key);

    if (listenersForKey !== undefined) {
        listenersForKey.delete(cb);
    }
}

function fireListenersForEvent(state: PolycentricState, key: string) {
    let listenersForKey = state.listeners.get(key);

    if (listenersForKey !== undefined) {
        for (const listener of listenersForKey) {
            listener();
        }
    }
}

export async function doesIdentityExist(
    state: PolycentricState,
): Promise<boolean> {
    return await doesKeyExist(state.level, IDENTITY_KEY);
}

export async function startIdentity(state: PolycentricState): Promise<void> {
    const identity = await levelLoadIdentity(state);
    state.identity = identity;
    Synchronization.synchronizationMain(state);
    Synchronization.addFeed(state, identity.publicKey);
    Synchronization.addAllFollowing(state);
    Synchronization.backfillServer(state);
}

export async function newIdentity(
    state: PolycentricState,
    profileName?: string,
) {
    const privateKey = Ed.utils.randomPrivateKey();

    await levelNewDeviceForExistingIdentity(state, privateKey);

    const message = makeDefaultEventBody();

    if (profileName === undefined) {
        profileName = 'Anonymous';
    }

    message.profile = {
        profileName: new TextEncoder().encode(profileName),
        profileDescription: undefined,
        profileServers: [
            new TextEncoder().encode('https://srv1.polycentric.io'),
        ],
    };

    await levelSavePost(state, message);
}

export async function loadProfile(
    state: PolycentricState,
): Promise<Protocol.StorageTypeProfile> {
    const identity = await levelLoadIdentity(state);

    const potentialProfile = await tryLoadKey(
        state.levelProfiles,
        identity.publicKey,
    );

    if (potentialProfile === undefined) {
        throw new Error('expected profile');
    }

    const profile: Protocol.StorageTypeProfile =
        Protocol.StorageTypeProfile.decode(potentialProfile);

    return profile;
}

export async function loadSpecificProfile(
    state: PolycentricState,
    publicKey: Uint8Array,
): Promise<Protocol.StorageTypeProfile | undefined> {
    const potentialProfile = await tryLoadKey(state.levelProfiles, publicKey);

    if (potentialProfile === undefined) {
        return undefined;
    }

    const profile: Protocol.StorageTypeProfile =
        Protocol.StorageTypeProfile.decode(potentialProfile);

    return profile;
}

export async function search(
    state: PolycentricState,
    query: string,
): Promise<Array<[string, Protocol.ResponseSearch]>> {
    const profile = await loadProfile(state);

    const result: Array<[string, Protocol.ResponseSearch]> = [];

    for (const server of profile.servers) {
        const address = new TextDecoder().decode(server);

        const response = await APIMethods.fetchPostSearch(address, {
            search: query,
        });

        result.push([address, response]);
    }

    return result;
}

export async function explore(
    state: PolycentricState,
    beforeTime: number | undefined,
): Promise<Array<[string, Protocol.ResponseSearch]>> {
    const profile = await loadProfile(state);

    const result: Array<[string, Protocol.ResponseSearch]> = [];

    for (const server of profile.servers) {
        try {
            const address = new TextDecoder().decode(server);

            const response = await APIMethods.fetchPostExplore(address, {
                beforeTime: beforeTime,
            });

            result.push([address, response]);
        } catch (err) {
            console.log('explore', err);
        }
    }

    return result;
}

export async function notifications(
    state: PolycentricState,
    afterIndex: number | undefined,
): Promise<Array<[string, Protocol.ResponseNotifications]>> {
    const identity = await levelLoadIdentity(state);
    const profile = await loadProfile(state);

    const result: Array<[string, Protocol.ResponseNotifications]> = [];

    for (const server of profile.servers) {
        const address = new TextDecoder().decode(server);

        const response = await APIMethods.fetchPostNotifications(address, {
            publicKey: identity.publicKey,
            afterIndex: afterIndex,
        });

        result.push([address, response]);
    }

    return result;
}

export async function recommend_profiles(
    state: PolycentricState,
): Promise<Array<[string, Protocol.Event]>> {
    const profile = await loadProfile(state);

    const result: Array<[string, Protocol.Event]> = [];

    for (const server of profile.servers) {
        try {
            const address = new TextDecoder().decode(server);

            const events = await APIMethods.fetchGetRecommendProfiles(address);

            for (const event of events.events) {
                result.push([address, event]);
            }
        } catch (err) {
            console.log('failed to fetch recommended', err);
        }
    }

    return result;
}

export function makeDefaultEventBody(): Protocol.EventBody {
    return {
        message: undefined,
        profile: undefined,
        follow: undefined,
        blobMeta: undefined,
        blobSection: undefined,
        delete: undefined,
    };
}

export async function saveBlob(
    state: PolycentricState,
    kind: string,
    blob: Uint8Array,
): Promise<Protocol.Pointer> {
    const meta = makeDefaultEventBody();
    meta.blobMeta = {
        sectionCount: 1,
        kind: kind,
    };

    const section = makeDefaultEventBody();
    section.blobSection = {
        metaPointer: 0,
        content: blob,
    };

    const pointer = await levelSavePost(state, meta);

    section.blobSection.metaPointer = pointer.sequenceNumber;

    await levelSavePost(state, section);

    return pointer;
}

export async function deletePost(
    state: PolycentricState,
    pointer: Protocol.Pointer,
): Promise<Protocol.Pointer> {
    const body = makeDefaultEventBody();
    body.delete = {
        pointer: pointer,
    };
    return await levelSavePost(state, body);
}

export type BlobWithKind = {
    kind: string;
    blob: Uint8Array;
};

export async function tryLoadStorageEventByPointer(
    state: PolycentricState,
    pointer: Protocol.Pointer,
): Promise<Protocol.StorageTypeEvent | undefined> {
    const value = await tryLoadStorageEventByKey(
        state,
        makeStorageTypeEventKey(
            pointer.publicKey,
            pointer.writerId,
            pointer.sequenceNumber,
        ),
    );

    return value;
}

export async function tryLoadStorageEventByKey(
    state: PolycentricState,
    key: Uint8Array,
): Promise<Protocol.StorageTypeEvent | undefined> {
    const raw = await tryLoadKey(state.levelEvents, key);

    if (raw === undefined) {
        const pointer = parseStorageTypeEventKey(key);

        Synchronization.needPointer(state, pointer);

        return undefined;
    }

    return Protocol.StorageTypeEvent.decode(raw);
}

export async function loadBlob(
    state: PolycentricState,
    pointer: Protocol.Pointer,
    dependencyContext: DependencyContext,
): Promise<BlobWithKind | undefined> {
    dependencyContext.addDependency(pointer);

    const outerMeta = await tryLoadStorageEventByPointer(state, pointer);

    if (outerMeta === undefined) {
        console.log('tried to load blob without a meta event');
        return undefined;
    }

    if (outerMeta.event === undefined) {
        return undefined;
    }

    const meta = outerMeta.event;

    const decodedMeta = Protocol.EventBody.decode(meta.content);

    if (decodedMeta.blobMeta === undefined) {
        console.log('tried to load blob where meta event is wrong type');
        return undefined;
    }

    let result = new Uint8Array();

    for (let i = 1; i <= decodedMeta.blobMeta.sectionCount; i++) {
        const sectionPointer = {
            publicKey: pointer.publicKey,
            writerId: pointer.writerId,
            sequenceNumber: pointer.sequenceNumber + i,
        };

        dependencyContext.addDependency(sectionPointer);

        const outerSection = await tryLoadStorageEventByPointer(
            state,
            sectionPointer,
        );

        if (outerSection === undefined) {
            console.log('tried to load blob without a meta section');
            return undefined;
        }

        if (outerSection.event === undefined) {
            return undefined;
        }

        const section = outerSection.event;

        const decodedSection = Protocol.EventBody.decode(section.content);

        if (decodedSection.blobSection === undefined) {
            console.log('blob section was invalid type');
            return undefined;
        }

        result = decodedSection.blobSection.content;
    }

    return {
        kind: decodedMeta.blobMeta.kind,
        blob: result,
    };
}

function deepCopyUint8Array(src: Uint8Array): Uint8Array {
    return src.slice(0);
}

function deepCopyEvent(event: Protocol.Event): Protocol.Event {
    if (event.signature === undefined) {
        throw new Error('signature was undefined');
    }

    return {
        writerId: deepCopyUint8Array(event.writerId),
        authorPublicKey: deepCopyUint8Array(event.authorPublicKey),
        sequenceNumber: event.sequenceNumber,
        content: deepCopyUint8Array(event.content),
        signature: deepCopyUint8Array(event.signature),
        unixMilliseconds: event.unixMilliseconds,
        clocks: event.clocks.map((clock) => {
            return {
                key: deepCopyUint8Array(clock.key),
                value: clock.value,
            };
        }),
    };
}

export function bodyToEventBodyType(
    body: Protocol.EventBody,
): EventMessageType {
    if (body.message !== undefined) {
        return EventMessageType.Message;
    } else if (body.profile !== undefined) {
        return EventMessageType.Profile;
    } else if (body.follow !== undefined) {
        return EventMessageType.Follow;
    } else if (body.blobMeta !== undefined) {
        return EventMessageType.BlobMeta;
    } else if (body.blobSection !== undefined) {
        return EventMessageType.BlobSection;
    } else if (body.delete !== undefined) {
        return EventMessageType.Delete;
    } else {
        return EventMessageType.Unknown;
    }
}

export async function rangesForFeed(
    state: PolycentricState,
    publicKey: Uint8Array,
    writerId: Uint8Array,
): Promise<Array<Protocol.StorageTypeRange>> {
    const minKey = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

    const maxKey = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);

    return (
        await state.levelRanges
            .values({
                lte: appendBuffers(appendBuffers(publicKey, writerId), maxKey),
                gte: appendBuffers(appendBuffers(publicKey, writerId), minKey),
            })
            .all()
    ).map((x) => Protocol.StorageTypeRange.decode(x));
}

export async function isFeedComplete(
    state: PolycentricState,
    publicKey: Uint8Array,
): Promise<boolean> {
    const potentialProfile = await tryLoadKey(state.levelProfiles, publicKey);

    if (potentialProfile === undefined) {
        return false;
    }

    const profile = Protocol.StorageTypeProfile.decode(potentialProfile);

    for (const entry of profile.heads) {
        const ranges = await rangesForFeed(state, publicKey, entry.key);

        let sum = 0;
        for (const range of ranges) {
            sum += range.highSequenceNumber - range.lowSequenceNumber + 1;
        }

        if (sum < entry.value) {
            return false;
        }
    }

    return true;
}

export async function makeSyncStatusString(
    state: PolycentricState,
    publicKey: Uint8Array,
) {
    const potentialProfile = await tryLoadKey(state.levelProfiles, publicKey);

    if (potentialProfile === undefined) {
        return 'unknown profile';
    }

    const profile = Protocol.StorageTypeProfile.decode(potentialProfile);

    let status = '';

    for (const entry of profile.heads) {
        const ranges = await rangesForFeed(state, publicKey, entry.key);

        let sum = 0;
        for (const range of ranges) {
            sum += range.highSequenceNumber - range.lowSequenceNumber + 1;
        }

        status += sum.toString() + '/' + entry.value.toString() + ' ';
    }

    return status;
}

function makeStorageTypeRangeKey(
    publicKey: Uint8Array,
    writerId: Uint8Array,
    lowSequenceNumber: number,
): Uint8Array {
    if (publicKey.length != 32) {
        throw new Error('expected publicKey to be 32 bytes');
    }

    if (writerId.length != 32) {
        throw new Error('expected writerId to be 32 bytes');
    }

    const number = Util.numberToBinary(lowSequenceNumber);
    const merged = new Uint8Array(
        publicKey.length + writerId.length + number.length,
    );
    merged.set(publicKey);
    merged.set(writerId, publicKey.length);
    merged.set(number, publicKey.length + writerId.length);
    return merged;
}

export function makeStorageTypeEventKey(
    publicKey: Uint8Array,
    writerId: Uint8Array,
    sequenceNumber: number,
): Uint8Array {
    if (publicKey.length != 32) {
        throw new Error('expected publicKey to be 32 bytes');
    }

    if (writerId.length != 32) {
        throw new Error('expected writerId to be 32 bytes');
    }

    const number = Util.numberToBinary(sequenceNumber);
    const merged = new Uint8Array(
        publicKey.length + writerId.length + number.length,
    );
    merged.set(publicKey);
    merged.set(writerId, publicKey.length);
    merged.set(number, publicKey.length + writerId.length);
    return merged;
}

export function parseStorageTypeEventKey(key: Uint8Array): Protocol.Pointer {
    if (key.length !== 32 + 32 + 8) {
        throw new Error('unexpected key size');
    }

    const publicKey = key.slice(0, 32);
    const writerId = key.slice(32, 32 + 32);
    const sequenceNumberArray = Array.from(key.slice(64, 64 + 8));

    const sequenceNumber = Long.fromBytesLE(
        sequenceNumberArray,
        true,
    ).toNumber();

    return {
        publicKey: publicKey,
        writerId: writerId,
        sequenceNumber: sequenceNumber,
    };
}

export function appendBuffers(left: Uint8Array, right: Uint8Array): Uint8Array {
    const merged = new Uint8Array(left.length + right.length);
    merged.set(left);
    merged.set(right, left.length);
    return merged;
}

export function makeStorageTypeEventKeyByAuthorByTime(
    publicKey: Uint8Array,
    unixMilliseconds: number,
): Uint8Array {
    const number = Util.numberToBinaryBE(unixMilliseconds);
    const merged = new Uint8Array(publicKey.length + number.length);
    merged.set(publicKey);
    merged.set(number, publicKey.length);
    return merged;
}

function decodeStorageTypeRange(value: Uint8Array): Protocol.StorageTypeRange {
    return Protocol.StorageTypeRange.decode(value);
}

async function insertRange(
    table: AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>,
    event: Protocol.StorageTypeRange,
) {
    await table.put(
        makeStorageTypeRangeKey(
            event.publicKey,
            event.writerId,
            event.lowSequenceNumber,
        ),
        Protocol.StorageTypeRange.encode(event).finish(),
    );
}

async function insertEvent(
    table: AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>,
    event: Protocol.Event,
) {
    await table.put(
        makeStorageTypeEventKey(
            event.authorPublicKey,
            event.writerId,
            event.sequenceNumber,
        ),
        Protocol.StorageTypeEvent.encode({
            event: event,
            mutationPointer: undefined,
        }).finish(),
    );
}

export async function levelUpdateRanges(
    table: AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>,
    event: Protocol.Pointer,
) {
    const minKey = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    const maxKey = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);

    const key = makeStorageTypeRangeKey(
        event.publicKey,
        event.writerId,
        event.sequenceNumber,
    );

    const possibleLowRange = (
        await table
            .values({
                lt: key,
                gte: appendBuffers(
                    appendBuffers(event.publicKey, event.writerId),
                    minKey,
                ),
                limit: 1,
                reverse: true,
            })
            .all()
    ).map(decodeStorageTypeRange);

    const possibleHighRange = (
        await table
            .values({
                gt: key,
                lte: appendBuffers(
                    appendBuffers(event.publicKey, event.writerId),
                    maxKey,
                ),
                limit: 1,
            })
            .all()
    ).map(decodeStorageTypeRange);

    if (
        possibleHighRange.length !== 0 &&
        possibleHighRange[0].highSequenceNumber >= event.sequenceNumber &&
        possibleHighRange[0].lowSequenceNumber <= event.sequenceNumber
    ) {
        return;
    }

    if (
        possibleLowRange.length !== 0 &&
        possibleLowRange[0].highSequenceNumber >= event.sequenceNumber &&
        possibleLowRange[0].lowSequenceNumber <= event.sequenceNumber
    ) {
        return;
    }

    if (
        possibleLowRange.length !== 0 &&
        possibleHighRange.length !== 0 &&
        possibleLowRange[0].highSequenceNumber + 2 ===
            possibleHighRange[0].lowSequenceNumber
    ) {
        await table.batch([
            {
                type: 'del',
                key: makeStorageTypeRangeKey(
                    event.publicKey,
                    event.writerId,
                    possibleHighRange[0].lowSequenceNumber,
                ),
            },
            {
                type: 'put',
                key: makeStorageTypeRangeKey(
                    event.publicKey,
                    event.writerId,
                    possibleLowRange[0].lowSequenceNumber,
                ),
                value: Protocol.StorageTypeRange.encode({
                    publicKey: event.publicKey,
                    writerId: event.writerId,
                    lowSequenceNumber: possibleLowRange[0].lowSequenceNumber,
                    highSequenceNumber: possibleHighRange[0].highSequenceNumber,
                }).finish(),
            },
        ]);
    } else if (
        possibleHighRange.length !== 0 &&
        possibleHighRange[0].lowSequenceNumber - 1 === event.sequenceNumber
    ) {
        await table.batch([
            {
                type: 'del',
                key: makeStorageTypeRangeKey(
                    event.publicKey,
                    event.writerId,
                    possibleHighRange[0].lowSequenceNumber,
                ),
            },
            {
                type: 'put',
                key: makeStorageTypeRangeKey(
                    event.publicKey,
                    event.writerId,
                    event.sequenceNumber,
                ),
                value: Protocol.StorageTypeRange.encode({
                    publicKey: event.publicKey,
                    writerId: event.writerId,
                    lowSequenceNumber: event.sequenceNumber,
                    highSequenceNumber: possibleHighRange[0].highSequenceNumber,
                }).finish(),
            },
        ]);
    } else if (
        possibleLowRange.length !== 0 &&
        possibleLowRange[0].highSequenceNumber + 1 === event.sequenceNumber
    ) {
        await insertRange(table, {
            publicKey: event.publicKey,
            writerId: event.writerId,
            lowSequenceNumber: possibleLowRange[0].lowSequenceNumber,
            highSequenceNumber: event.sequenceNumber,
        });
    } else {
        await insertRange(table, {
            publicKey: event.publicKey,
            writerId: event.writerId,
            lowSequenceNumber: event.sequenceNumber,
            highSequenceNumber: event.sequenceNumber,
        });
    }
}

async function doesKeyExist(
    table: AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>,
    key: Uint8Array,
) {
    try {
        await table.get(key);
        return true;
    } catch (err) {
        return false;
    }
}

export async function tryLoadKey(
    table: AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>,
    key: Uint8Array,
): Promise<Uint8Array | undefined> {
    try {
        return await table.get(key);
    } catch (err) {
        return undefined;
    }
}

export async function levelSaveEvent(
    state: PolycentricState,
    eventTainted: Protocol.Event,
) {
    return await state.lock.acquire('lock', async () => {
        const event = deepCopyEvent(eventTainted);

        const key = makeStorageTypeEventKey(
            event.authorPublicKey,
            event.writerId,
            event.sequenceNumber,
        );

        if ((await doesKeyExist(state.levelEvents, key)) === true) {
            return;
        }

        const body = Protocol.EventBody.decode(event.content);

        let mutatedProfile = false;

        {
            let mutated = false;

            const rawExisting = await tryLoadKey(
                state.levelProfiles,
                event.authorPublicKey,
            );

            if (rawExisting === undefined) {
                mutated = true;
            }

            let profile: Protocol.StorageTypeProfile = {
                publicKey: event.authorPublicKey,
                username: new TextEncoder().encode('unknown'),
                description: undefined,
                imagePointer: undefined,
                mutatedBy: undefined,
                unixMilliseconds: 0,
                heads: [],
                servers: [],
            };

            if (rawExisting !== undefined) {
                profile = Protocol.StorageTypeProfile.decode(rawExisting);
            }

            if (
                body.profile !== undefined &&
                profile.unixMilliseconds < event.unixMilliseconds
            ) {
                profile.username = body.profile.profileName;
                profile.description = body.profile.profileDescription;
                profile.servers = body.profile.profileServers;
                profile.imagePointer = body.profile.profileImagePointer;
                profile.unixMilliseconds = event.unixMilliseconds;
                profile.mutatedBy = {
                    publicKey: event.authorPublicKey,
                    writerId: event.writerId,
                    sequenceNumber: event.sequenceNumber,
                };

                mutated = true;
            }

            let foundHead = false;
            for (const head of profile.heads) {
                if (Util.blobsEqual(head.key, event.writerId)) {
                    if (head.value < event.sequenceNumber) {
                        head.value = event.sequenceNumber;
                        mutated = true;
                    }
                    foundHead = true;
                    break;
                }
            }
            if (foundHead === false) {
                profile.heads.push({
                    key: event.writerId,
                    value: event.sequenceNumber,
                });
                mutated = true;
            }

            if (mutated) {
                await state.levelProfiles.put(
                    event.authorPublicKey,
                    Protocol.StorageTypeProfile.encode(profile).finish(),
                );
            }

            mutatedProfile = mutated;
        }

        if (body.follow !== undefined) {
            const messageFromIdentity = Util.blobsEqual(
                (await levelLoadIdentity(state)).publicKey,
                event.authorPublicKey,
            );

            if (messageFromIdentity) {
                let update = false;

                const existing = await tryLoadKey(
                    state.levelFollowing,
                    body.follow.publicKey,
                );

                if (existing === undefined) {
                    update = true;
                } else {
                    const decoded =
                        Protocol.StorageTypeFollowing.decode(existing);

                    if (decoded.unixMilliseconds < event.unixMilliseconds) {
                        update = true;
                    }
                }

                if (update === true) {
                    await state.levelFollowing.put(
                        body.follow.publicKey,
                        Protocol.StorageTypeFollowing.encode({
                            publicKey: body.follow.publicKey,
                            unixMilliseconds: event.unixMilliseconds,
                            unfollow: body.follow.unfollow,
                        }).finish(),
                    );

                    if (body.follow.unfollow === false) {
                        Synchronization.addFeed(state, body.follow.publicKey);
                    }
                }
            }
        }

        if (body.delete !== undefined && body.delete.pointer !== undefined) {
            const pointer = body.delete.pointer;

            if (Util.blobsEqual(pointer.publicKey, event.authorPublicKey)) {
                await state.levelEvents.put(
                    makeStorageTypeEventKey(
                        pointer.publicKey,
                        pointer.writerId,
                        pointer.sequenceNumber,
                    ),
                    Protocol.StorageTypeEvent.encode({
                        event: undefined,
                        mutationPointer: {
                            publicKey: event.authorPublicKey,
                            writerId: event.writerId,
                            sequenceNumber: event.sequenceNumber,
                        },
                    }).finish(),
                );

                await levelUpdateRanges(state.levelRanges, pointer);
            } else {
                console.log('received malicious delete');
            }
        }

        await levelUpdateRanges(state.levelRanges, {
            publicKey: event.authorPublicKey,
            writerId: event.writerId,
            sequenceNumber: event.sequenceNumber,
        });

        await insertEvent(state.levelEvents, event);

        {
            const key = Base64.encode(
                makeStorageTypeEventKey(
                    event.authorPublicKey,
                    event.writerId,
                    event.sequenceNumber,
                ),
            );

            fireListenersForEvent(state, key);
        }

        if (mutatedProfile) {
            const key = Base64.encode(
                new Uint8Array([
                    ...new TextEncoder().encode('!profiles!'),
                    ...event.authorPublicKey,
                ]),
            );

            fireListenersForEvent(state, key);
        }

        if (body.message !== undefined) {
            await state.levelIndexPostByTime.put(
                deepCopyUint8Array(
                    Util.numberToBinaryBE(event.unixMilliseconds),
                ),
                deepCopyUint8Array(key),
            );

            await state.levelIndexPostByAuthorByTime.put(
                makeStorageTypeEventKeyByAuthorByTime(
                    event.authorPublicKey,
                    event.unixMilliseconds,
                ),
                deepCopyUint8Array(key),
            );
        }
    });
}

export async function levelFollowUser(
    state: PolycentricState,
    publicKey: Uint8Array,
) {
    if (!(await levelAmFollowing(state, publicKey))) {
        const event = makeDefaultEventBody();
        event.follow = {
            publicKey: publicKey,
            unfollow: false,
        };

        await levelSavePost(state, event);
    } else {
        console.log('already following');
    }
}

export async function levelUnfollowUser(
    state: PolycentricState,
    publicKey: Uint8Array,
) {
    if (await levelAmFollowing(state, publicKey)) {
        const event = makeDefaultEventBody();
        event.follow = {
            publicKey: publicKey,
            unfollow: true,
        };

        await levelSavePost(state, event);
    } else {
        console.log('not already following');
    }
}

export async function levelAmFollowing(
    state: PolycentricState,
    publicKey: Uint8Array,
) {
    const result = await tryLoadKey(state.levelFollowing, publicKey);

    if (result === undefined) {
        return false;
    }

    const parsed = Protocol.StorageTypeFollowing.decode(result);

    return !parsed.unfollow;
}

export async function levelLoadFollowing(
    state: PolycentricState,
): Promise<Array<Uint8Array>> {
    const result = [];

    const all = await state.levelFollowing.values().all();

    for (const value of all) {
        const decoded = Protocol.StorageTypeFollowing.decode(value);

        if (decoded.unfollow === false) {
            result.push(decoded.publicKey);
        }
    }

    return result;
}

const IDENTITY_KEY = new TextEncoder().encode('IDENTITY');

export async function levelNewDeviceForExistingIdentity(
    state: PolycentricState,
    privateKey: Uint8Array,
) {
    const writerId = Ed.utils.randomPrivateKey();

    await state.level.put(
        IDENTITY_KEY,
        Protocol.StorageTypeIdentity.encode({
            privateKey: privateKey,
            writerId: writerId,
            sequenceNumber: 0,
        }).finish(),
    );
}

export async function levelLoadIdentity(
    state: PolycentricState,
): Promise<IIdentityState> {
    const rawResult = await tryLoadKey(state.level, IDENTITY_KEY);

    if (rawResult === undefined) {
        throw new Error('Expected identity to exist');
    }

    const identity = Protocol.StorageTypeIdentity.decode(rawResult);

    const publicKey = await Ed.getPublicKey(identity.privateKey);

    return {
        privateKey: identity.privateKey,
        writerId: identity.writerId,
        publicKey: publicKey,
        sequenceNumber: identity.sequenceNumber,
    };
}

export async function levelSavePost(
    state: PolycentricState,
    message: Protocol.EventBody,
): Promise<Protocol.Pointer> {
    const identity = await levelLoadIdentity(state);

    identity.sequenceNumber += 1;

    const content = Protocol.EventBody.encode(message).finish();

    const event: Protocol.Event = {
        writerId: identity.writerId,
        authorPublicKey: identity.publicKey,
        sequenceNumber: identity.sequenceNumber,
        content: content,
        clocks: [],
        signature: undefined,
        previousEventHash: undefined,
        unixMilliseconds: Date.now(),
    };

    await Crypto.addEventSignature(event, identity.privateKey);

    await state.level.put(
        IDENTITY_KEY,
        Protocol.StorageTypeIdentity.encode({
            privateKey: identity.privateKey,
            writerId: identity.writerId,
            sequenceNumber: identity.sequenceNumber,
        }).finish(),
    );

    await levelSaveEvent(state, event);

    if (state.autoSync === true) {
        Synchronization.backfillServer(state);
    }

    return {
        publicKey: identity.publicKey,
        writerId: identity.writerId,
        sequenceNumber: event.sequenceNumber,
    };
}
