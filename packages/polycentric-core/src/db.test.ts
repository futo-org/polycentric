import * as Ed from '@noble/ed25519';
import * as MemoryLevel from 'memory-level';

import * as DB from './db';
import * as Protocol from './protocol';
import * as Util from './Util';
import * as Keys from './keys';
import * as Ingest from './ingest';
import * as Crypto from './crypto';

describe('subtractRange', () => {
    test('both empty are empty', () => {
        expect(Util.subtractRange([], [])).toStrictEqual([]);
    });

    test('left empty result empty', () => {
        expect(Util.subtractRange([], [{ low: 5, high: 10 }])).toStrictEqual(
            [],
        );
    });

    test('right empty is identity', () => {
        expect(Util.subtractRange([{ low: 5, high: 10 }], [])).toStrictEqual([
            { low: 5, high: 10 },
        ]);
    });

    test('right totally subtracts left', () => {
        expect(
            Util.subtractRange([{ low: 5, high: 10 }], [{ low: 5, high: 10 }]),
        ).toStrictEqual([]);
    });

    test('right subtracts lower portion of left', () => {
        expect(
            Util.subtractRange([{ low: 5, high: 10 }], [{ low: 3, high: 7 }]),
        ).toStrictEqual([{ low: 8, high: 10 }]);
    });

    test('right subtracts higher portion of left', () => {
        expect(
            Util.subtractRange([{ low: 5, high: 10 }], [{ low: 7, high: 15 }]),
        ).toStrictEqual([{ low: 5, high: 6 }]);
    });

    test('right splits middle of left', () => {
        expect(
            Util.subtractRange([{ low: 1, high: 10 }], [{ low: 3, high: 6 }]),
        ).toStrictEqual([
            { low: 1, high: 2 },
            { low: 7, high: 10 },
        ]);
    });

    test('complex', () => {
        expect(
            Util.subtractRange(
                [
                    { low: 1, high: 10 },
                    { low: 20, high: 30 },
                    { low: 50, high: 50 },
                ],
                [
                    { low: 0, high: 5 },
                    { low: 8, high: 12 },
                    { low: 31, high: 60 },
                ],
            ),
        ).toStrictEqual([
            { low: 6, high: 7 },
            { low: 20, high: 30 },
        ]);
    });
});

describe('sortRangeItems', () => {
    test('sorts ranges', () => {
        expect(
            Util.sortRangeItems([
                { low: 51, high: 70 },
                { low: 12, high: 15 },
                { low: 81, high: 82 },
            ]),
        ).toStrictEqual([
            { low: 12, high: 15 },
            { low: 51, high: 70 },
            { low: 81, high: 82 },
        ]);
    });
});

describe('takeRangesMaxItems', () => {
    test('empty returns empty', () => {
        expect(Util.takeRangesMaxItems([], 10)).toStrictEqual([]);
    });

    test('zero and non empty returns empty', () => {
        expect(
            Util.takeRangesMaxItems([{ low: 51, high: 70 }], 0),
        ).toStrictEqual([]);
    });

    test('less than total truncates', () => {
        expect(
            Util.takeRangesMaxItems(
                [
                    { low: 5, high: 10 },
                    { low: 10, high: 15 },
                    { low: 20, high: 25 },
                ],
                8,
            ),
        ).toStrictEqual([
            { low: 13, high: 15 },
            { low: 20, high: 25 },
        ]);
    });

    test('more than total uses all', () => {
        expect(
            Util.takeRangesMaxItems(
                [
                    { low: 5, high: 10 },
                    { low: 10, high: 15 },
                    { low: 20, high: 25 },
                ],
                50,
            ),
        ).toStrictEqual([
            { low: 5, high: 10 },
            { low: 10, high: 15 },
            { low: 20, high: 25 },
        ]);
    });

    test('empty returns empty', () => {
        expect(Util.takeRangesMaxItems([], 10)).toStrictEqual([]);
    });
});

function makeTestState(): DB.PolycentricState {
    const level = new MemoryLevel.MemoryLevel<Uint8Array, Uint8Array>({
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
    }) as DB.BinaryAbstractLevel;

    const state = new DB.PolycentricState(
        level,
        DB.StorageDriver.Memory,
        'tests',
    );
    state.autoSync = false;
    return state;
}

let privateKey = new Uint8Array(32);
let publicKey = new Uint8Array(32);
let writerId = new Uint8Array(32);
let content = new Uint8Array(0);
let signature = new Uint8Array(0);

async function setupTestData(): Promise<void> {
    privateKey = await Ed.utils.randomPrivateKey();
    writerId = await Ed.utils.randomPrivateKey();
}

async function makeTestEvent(sequenceNumber: number): Promise<Protocol.Event> {
    const event: Protocol.Event = {
        writerId: writerId,
        authorPublicKey: publicKey,
        sequenceNumber: sequenceNumber,
        content: content,
        clocks: [],
        signature: signature,
        previousEventHash: undefined,
        unixMilliseconds: Date.now(),
    };

    await Crypto.addEventSignature(event, privateKey);

    return event;
}

function makeTestPointer(sequenceNumber: number): Protocol.Pointer {
    return {
        writerId: writerId,
        publicKey: publicKey,
        sequenceNumber: sequenceNumber,
    };
}

describe('levelStoreRanges', () => {
    test('discontinuous', async () => {
        const state = makeTestState();
        const db = state.levelRanges;

        await Ingest.levelUpdateRanges(db, makeTestPointer(0));
        await Ingest.levelUpdateRanges(db, makeTestPointer(2));
        await Ingest.levelUpdateRanges(db, makeTestPointer(4));

        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 0,
                    highSequenceNumber: 0,
                },
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 2,
                    highSequenceNumber: 2,
                },
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 4,
                    highSequenceNumber: 4,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('highMerge', async () => {
        const state = makeTestState();
        const db = state.levelRanges;

        await Ingest.levelUpdateRanges(db, makeTestPointer(5));
        await Ingest.levelUpdateRanges(db, makeTestPointer(11));
        await Ingest.levelUpdateRanges(db, makeTestPointer(10));

        expect(await db.values().all()).toStrictEqual([
            Protocol.StorageTypeRange.encode({
                publicKey: publicKey,
                writerId: writerId,
                lowSequenceNumber: 5,
                highSequenceNumber: 5,
            }).finish(),
            Protocol.StorageTypeRange.encode({
                publicKey: publicKey,
                writerId: writerId,
                lowSequenceNumber: 10,
                highSequenceNumber: 11,
            }).finish(),
        ]);
    });

    test('highMergeNoLow', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        await Ingest.levelUpdateRanges(db, makeTestPointer(115));
        await Ingest.levelUpdateRanges(db, makeTestPointer(114));
        await Ingest.levelUpdateRanges(db, makeTestPointer(113));
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 113,
                    highSequenceNumber: 115,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('lowMerge', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        await Ingest.levelUpdateRanges(db, makeTestPointer(11));
        await Ingest.levelUpdateRanges(db, makeTestPointer(4));
        await Ingest.levelUpdateRanges(db, makeTestPointer(12));
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 4,
                    highSequenceNumber: 4,
                },
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 11,
                    highSequenceNumber: 12,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('lowMergeNoHigh', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        await Ingest.levelUpdateRanges(db, makeTestPointer(52));
        await Ingest.levelUpdateRanges(db, makeTestPointer(53));
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 52,
                    highSequenceNumber: 53,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('highAndLowMerge', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        await Ingest.levelUpdateRanges(db, makeTestPointer(22));
        await Ingest.levelUpdateRanges(db, makeTestPointer(24));
        await Ingest.levelUpdateRanges(db, makeTestPointer(23));
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 22,
                    highSequenceNumber: 24,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('manyContinuous', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        await Ingest.levelUpdateRanges(db, makeTestPointer(5));
        await Ingest.levelUpdateRanges(db, makeTestPointer(6));
        await Ingest.levelUpdateRanges(db, makeTestPointer(7));
        await Ingest.levelUpdateRanges(db, makeTestPointer(8));
        await Ingest.levelUpdateRanges(db, makeTestPointer(9));
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 5,
                    highSequenceNumber: 9,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('mergeLargeBlocks', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        await Ingest.levelUpdateRanges(db, makeTestPointer(3));
        await Ingest.levelUpdateRanges(db, makeTestPointer(2));
        await Ingest.levelUpdateRanges(db, makeTestPointer(1));
        await Ingest.levelUpdateRanges(db, makeTestPointer(6));
        await Ingest.levelUpdateRanges(db, makeTestPointer(5));
        await Ingest.levelUpdateRanges(db, makeTestPointer(4));
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 1,
                    highSequenceNumber: 6,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('insertIntoExistingRange', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        await Ingest.levelUpdateRanges(db, makeTestPointer(1));
        await Ingest.levelUpdateRanges(db, makeTestPointer(2));
        await Ingest.levelUpdateRanges(db, makeTestPointer(3));
        await Ingest.levelUpdateRanges(db, makeTestPointer(4));
        await Ingest.levelUpdateRanges(db, makeTestPointer(2));
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 1,
                    highSequenceNumber: 4,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
    });

    test('bulkUpdate', async () => {
        const state = makeTestState();
        const db = state.levelRanges;
        for (let i = 0; i < 1000; i++) {
            await Ingest.levelUpdateRanges(db, makeTestPointer(i));
        }
        /*
        expect(await db.values().all()).toStrictEqual(
            [
                {
                    publicKey: publicKey,
                    writerId: writerId,
                    lowSequenceNumber: 0,
                    highSequenceNumber: 999,
                },
            ].map((x) => Protocol.StorageTypeRange.encode(x).finish()),
        );
        */
    });
});

/*
function makeFollowEvent(sequenceNumber: number): Protocol.Event {
    const event = DB.makeDefaultEventBody();
    event.follow = {
        publicKey: publicKey,
        unfollow: false,
    };

    return {
        writerId: writerId,
        authorPublicKey: publicKey,
        sequenceNumber: sequenceNumber,
        content: Protocol.EventBody.encode(event).finish(),
        clocks: [],
        signature: signature,
        previousEventHash: undefined,
        unixMilliseconds: sequenceNumber,
    };
}
*/

describe('levelStoreEvent', () => {
    beforeEach(async () => {
        await setupTestData();
    });

    test('followUserAPI', async () => {
        const state = makeTestState();
        await DB.newIdentity(state);

        expect(await DB.levelAmFollowing(state, publicKey)).toStrictEqual(
            false,
        );

        await DB.levelFollowUser(state, publicKey);

        expect(await DB.levelAmFollowing(state, publicKey)).toStrictEqual(true);

        await DB.levelUnfollowUser(state, publicKey);

        expect(await DB.levelAmFollowing(state, publicKey)).toStrictEqual(
            false,
        );
    });

    test('isFeedComplete', async () => {
        const state = makeTestState();
        await DB.newIdentity(state);

        expect(await DB.isFeedComplete(state, publicKey)).toStrictEqual(false);

        await Ingest.levelSaveEvent(state, await makeTestEvent(1));

        expect(await DB.isFeedComplete(state, publicKey)).toStrictEqual(true);

        await Ingest.levelSaveEvent(state, await makeTestEvent(3));

        expect(await DB.isFeedComplete(state, publicKey)).toStrictEqual(false);

        await Ingest.levelSaveEvent(state, await makeTestEvent(2));

        expect(await DB.isFeedComplete(state, publicKey)).toStrictEqual(true);
    });

    test('makeSyncStatusString', async () => {
        const state = makeTestState();
        await DB.newIdentity(state);

        expect(await DB.makeSyncStatusString(state, publicKey)).toStrictEqual(
            'unknown profile',
        );

        await Ingest.levelSaveEvent(state, await makeTestEvent(1));

        expect(await DB.makeSyncStatusString(state, publicKey)).toStrictEqual(
            '1/1 ',
        );

        await Ingest.levelSaveEvent(state, await makeTestEvent(5));

        expect(await DB.makeSyncStatusString(state, publicKey)).toStrictEqual(
            '2/5 ',
        );

        await Ingest.levelSaveEvent(state, await makeTestEvent(2));

        expect(await DB.makeSyncStatusString(state, publicKey)).toStrictEqual(
            '3/5 ',
        );
    });
});

describe('keySerializationAndParsing', () => {
    test('storageTypeEvent', () => {
        const publicKey = Ed.utils.randomPrivateKey();
        const writerId = Ed.utils.randomPrivateKey();
        const sequenceNumber = Math.floor(Math.random() * 100);

        const encoded = Keys.pointerToKey({
            publicKey: publicKey,
            writerId: writerId,
            sequenceNumber: sequenceNumber,
        });

        const decoded = Keys.keyToPointer(encoded);

        expect(decoded).toStrictEqual({
            publicKey: publicKey,
            writerId: writerId,
            sequenceNumber: sequenceNumber,
        });
    });
});
