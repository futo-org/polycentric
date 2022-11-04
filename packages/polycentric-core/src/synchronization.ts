import * as Base64 from '@borderless/base64';
import Deque from 'double-ended-queue';

import * as DB from './db';
import * as Keys from './keys';
import * as Protocol from './protocol';
import * as APIMethods from './APIMethods';
import * as Util from './Util';

type FeedSyncState = {
    publicKey: Uint8Array;
    lastNoProgressTime: number;
};

export class SynchronizationState {
    feeds: Deque<FeedSyncState>;
    feedSet: Set<string>;
    pointerSet: Set<string>;

    constructor() {
        this.feeds = new Deque();
        this.feedSet = new Set();
        this.pointerSet = new Set();
    }
}

export async function needPointer(
    state: DB.PolycentricState,
    pointer: Protocol.Pointer,
) {
    const key = Base64.encode(Keys.pointerToKey(pointer));

    if (!state.sync.pointerSet.has(key)) {
        state.sync.pointerSet.add(key);

        console.log('trying to load sequence', pointer.sequenceNumber);

        await backfillClientSpecificPointer(state, pointer);

        state.sync.pointerSet.delete(key);
    }
}

export async function backfillClientSpecificPointer(
    state: DB.PolycentricState,
    pointer: Protocol.Pointer,
) {
    const profile = await DB.loadSpecificProfile(state, pointer.publicKey);

    if (profile === undefined) {
        return;
    }

    for (const server of profile.servers) {
        const address = new TextDecoder().decode(server);

        try {
            const events = await APIMethods.fetchPostRequestEventRanges(
                address,
                {
                    authorPublicKey: pointer.publicKey,
                    writerId: pointer.writerId,
                    ranges: [
                        {
                            low: pointer.sequenceNumber,
                            high: pointer.sequenceNumber,
                        },
                    ],
                },
            );

            console.log(
                'got count',
                events.events.length,
                'for',
                pointer.sequenceNumber,
                'from',
                address,
            );

            await saveBatch(state, events.events);
        } catch (err) {
            console.log('backfillClientSpecificPointer failed', address, err);
        }
    }
}

export function addFeed(state: DB.PolycentricState, publicKey: Uint8Array) {
    const publicKeyString = Base64.encodeUrl(publicKey);

    if (!state.sync.feedSet.has(publicKeyString)) {
        state.sync.feedSet.add(publicKeyString);
        state.sync.feeds.push({
            publicKey: publicKey,
            lastNoProgressTime: 0,
        });
    }
}

export async function addAllFollowing(state: DB.PolycentricState) {
    const following = await DB.levelLoadFollowing(state);

    for (const user of following) {
        addFeed(state, user);
    }
}

export async function synchronizationMain(state: DB.PolycentricState) {
    const handled = new Deque<FeedSyncState>();

    while (state.sync.feeds.isEmpty() === false) {
        const head = state.sync.feeds.shift();

        if (head === undefined) {
            continue;
        }

        if (head.lastNoProgressTime + 30 * 1000 < new Date().getTime()) {
            console.log('synchronizingFeed:', Base64.encodeUrl(head.publicKey));

            const progress = await backfillClient(state, {
                publicKey: head.publicKey,
                servers: [],
            });

            if (progress === false) {
                head.lastNoProgressTime = new Date().getTime();
            }
        }

        handled.push(head);
    }

    state.sync.feeds = handled;

    setTimeout(() => {
        synchronizationMain(state);
    }, 1000);
}

export async function saveBatch(
    state: DB.PolycentricState,
    events: Array<Protocol.Event>,
) {
    for (const event of events) {
        await DB.levelSaveEvent(state, event);
    }
}

export async function loadServerHead(
    state: DB.PolycentricState,
    info: Protocol.URLInfo,
) {
    const allServers: Set<string> = new Set();
    let heads: Array<Protocol.EventClockEntry> = [];

    const existing = await DB.loadSpecificProfile(state, info.publicKey);

    if (existing === undefined) {
        console.log('leadServerHead profile does not exist');
    } else {
        heads = existing.heads;

        for (const server of existing.servers) {
            allServers.add(new TextDecoder().decode(server));
        }
    }

    for (const server of info.servers) {
        allServers.add(new TextDecoder().decode(server));
    }

    const event: Protocol.RequestEventsHead = {
        authorPublicKey: info.publicKey,
        clocks: heads,
    };

    for (const address of allServers) {
        try {
            const events = await APIMethods.fetchPostHead(address, event);

            await saveBatch(state, events.events);
        } catch (err) {
            console.log('loadServerHead failed', address, err);
        }
    }
}

function databaseRangeToRangeItem(
    range: Protocol.StorageTypeRange,
): Util.RangeItem {
    return {
        low: range.lowSequenceNumber,
        high: range.highSequenceNumber,
    };
}

function protobufRangeToRangeItem(range: Protocol.Range): Util.RangeItem {
    return {
        low: range.low,
        high: range.high,
    };
}

function rangeItemToProtobufRange(range: Util.RangeItem): Protocol.Range {
    return {
        low: range.low,
        high: range.high,
    };
}

export async function backfillClient(
    state: DB.PolycentricState,
    info: Protocol.URLInfo,
): Promise<boolean> {
    try {
        return await backfillClientHistory(state, info.publicKey);
    } catch (err) {
        console.log('backfillClient', err);
    }

    return false;
}

export async function backfillClientHistory(
    state: DB.PolycentricState,
    publicKey: Uint8Array,
): Promise<boolean> {
    let progress = false;

    const existing = await DB.loadSpecificProfile(state, publicKey);

    if (existing === undefined) {
        return progress;
    }

    for (const server of existing.servers) {
        const address = new TextDecoder().decode(server);

        try {
            const serverKnownRangesAllWriters =
                await APIMethods.fetchPostKnownRangesForFeed(address, {
                    publicKey: publicKey,
                });

            for (const serverKnownRangesForWriter of serverKnownRangesAllWriters.writers) {
                const serverKnownRanges = serverKnownRangesForWriter.ranges.map(
                    protobufRangeToRangeItem,
                );

                const clientKnownRanges = (
                    await DB.rangesForFeed(
                        state,
                        publicKey,
                        serverKnownRangesForWriter.writerId,
                    )
                ).map(databaseRangeToRangeItem);

                const clientNeeds = Util.subtractRange(
                    serverKnownRanges,
                    clientKnownRanges,
                );

                if (clientNeeds.length === 0) {
                    continue;
                }

                progress = true;

                const clientNeedsSubset = Util.takeRangesMaxItems(
                    clientNeeds,
                    10,
                );

                const events = await APIMethods.fetchPostRequestEventRanges(
                    address,
                    {
                        authorPublicKey: publicKey,
                        writerId: serverKnownRangesForWriter.writerId,
                        ranges: clientNeedsSubset.map(rangeItemToProtobufRange),
                    },
                );

                await saveBatch(state, events.events);
            }
        } catch (err) {
            console.log('backfillClientHistory failed', address, err);
        }
    }

    return progress;
}

export async function processMutations(
    state: DB.PolycentricState,
    history: Array<Protocol.StorageTypeEvent>,
) {
    const result: Array<Protocol.Event> = [];

    const profileKeys = new Set<string>();

    const maybeAddProfile = async (publicKey: Uint8Array) => {
        const publicKeyString = Base64.encodeUrl(publicKey);

        if (!profileKeys.has(publicKeyString)) {
            profileKeys.add(publicKeyString);

            const potentialProfile = await DB.loadSpecificProfile(
                state,
                publicKey,
            );

            if (
                potentialProfile !== undefined &&
                potentialProfile.mutatedBy !== undefined
            ) {
                const pointer = potentialProfile.mutatedBy;

                const potentialEvent = await DB.tryLoadKey(
                    state.levelEvents,
                    Keys.pointerToKey(pointer),
                );

                if (potentialEvent !== undefined) {
                    const event =
                        Protocol.StorageTypeEvent.decode(potentialEvent);

                    if (event.event !== undefined) {
                        result.push(event.event);
                    }
                }
            }
        }
    };

    for (const event of history) {
        if (event.event !== undefined) {
            await maybeAddProfile(event.event.authorPublicKey);
        }

        if (event.mutationPointer === undefined) {
            if (event.event !== undefined) {
                result.push(event.event);

                const body = Protocol.EventBody.decode(event.event.content);

                if (body.follow !== undefined) {
                    await maybeAddProfile(body.follow.publicKey);
                } else if (
                    body.message !== undefined &&
                    body.message.boostPointer !== undefined
                ) {
                    await maybeAddProfile(body.message.boostPointer.publicKey);
                }
            }
        } else {
            const potentialMutation = await DB.tryLoadKey(
                state.levelEvents,
                Keys.pointerToKey(event.mutationPointer),
            );

            if (potentialMutation !== undefined) {
                const mutation =
                    Protocol.StorageTypeEvent.decode(potentialMutation);

                if (mutation.event !== undefined) {
                    result.push(mutation.event);
                }
            }
        }
    }

    return result;
}

export async function backfillSpecificServer(
    state: DB.PolycentricState,
    identity: DB.IIdentityState,
    address: string,
) {
    const eventBatchSize = 20;

    const serverKnownRanges = (
        await APIMethods.fetchPostKnownRanges(address, {
            authorPublicKey: identity.publicKey,
            writerId: identity.writerId,
        })
    ).ranges.map(protobufRangeToRangeItem);

    const clientKnownRanges = (
        await DB.rangesForFeed(state, identity.publicKey, identity.writerId)
    ).map(databaseRangeToRangeItem);

    const serverNeeds = Util.subtractRange(
        clientKnownRanges,
        serverKnownRanges,
    );

    const history: Array<Protocol.StorageTypeEvent> = [];

    for (const range of serverNeeds) {
        const events = (
            await state.levelEvents
                .values({
                    lte: Keys.pointerToKey({
                        publicKey: identity.publicKey,
                        writerId: identity.writerId,
                        sequenceNumber: range.high,
                    }),
                    gte: Keys.pointerToKey({
                        publicKey: identity.publicKey,
                        writerId: identity.writerId,
                        sequenceNumber: range.low,
                    }),
                    limit: eventBatchSize - history.length,
                })
                .all()
        ).map((x) => Protocol.StorageTypeEvent.decode(x));

        history.push(...events);

        if (history.length === eventBatchSize) {
            console.log('batch size hit');
            break;
        }
    }

    if (history.length === 0) {
        console.log('got no history so stopping backfill of server');
        return;
    }

    await APIMethods.fetchPostEvents(address, {
        events: await processMutations(state, history),
    });

    setTimeout(() => {
        backfillSpecificServer(state, identity, address);
    }, 1000);
}

export async function backfillServer(state: DB.PolycentricState) {
    const identity = await DB.levelLoadIdentity(state);
    const existing = await DB.loadProfile(state);

    for (const server of existing.servers) {
        const address = new TextDecoder().decode(server);

        try {
            await backfillSpecificServer(state, identity, address);
        } catch (err) {
            console.log('backfillServer failed', address, err);
        }
    }
}
