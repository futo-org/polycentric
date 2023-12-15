/* eslint jest/no-conditional-expect: 0 */
import * as ProcessHandle from '../process-handle';
import * as QueryIndex from './query-index';
import * as QueryCRDTSet from './query-crdt-set';
import * as Models from '../models';
import * as Protocol from '../protocol';

function setupQueryManager(
    processHandle: ProcessHandle.ProcessHandle,
    useNetwork: boolean,
    useDisk: boolean,
) {
    const queryIndexManager = new QueryIndex.QueryManager(processHandle);
    queryIndexManager.useNetwork(useNetwork);
    queryIndexManager.useDisk(useDisk);

    const queryManager = new QueryCRDTSet.QueryManager(queryIndexManager);

    processHandle.setListener((event) => queryIndexManager.update(event));

    return queryManager;
}

function extractSystem(cell: QueryIndex.Cell): Models.PublicKey.PublicKey {
    if (cell.signedEvent === undefined) {
        throw new Error('expected signed event');
    }

    const event = Models.Event.fromBuffer(cell.signedEvent.event);

    if (event.contentType.notEquals(Models.ContentType.ContentTypeFollow)) {
        throw new Error('expect ContentTypeFollow');
    }

    if (event.lwwElementSet === undefined) {
        throw new Error('expected lwwElementSet');
    }

    return Models.PublicKey.fromProto(
        Protocol.PublicKey.decode(event.lwwElementSet.value),
    );
}

describe('query crdt set', () => {
    test('non existant', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = setupQueryManager(s1p1, false, false);

        const handle = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeFollow,
            (value) => {
                throw Error('unexpected');
            },
        );

        handle.unregister();
    });

    test('update during query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        const s3p1 = await ProcessHandle.createTestProcessHandle();
        const s4p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = setupQueryManager(s1p1, false, true);

        let stage = 0;
        let handle: QueryCRDTSet.QueryHandle | undefined;

        await new Promise<void>(async (resolve) => {
            const cb = (value: QueryIndex.CallbackParameters) => {
                if (stage === 0) {
                    expect(value.add.length).toStrictEqual(2);
                    expect(value.remove.size).toStrictEqual(0);
                    expect(
                        Models.PublicKey.equal(
                            extractSystem(value.add[0]),
                            s3p1.system(),
                        ),
                    ).toStrictEqual(true);
                    expect(
                        Models.PublicKey.equal(
                            extractSystem(value.add[1]),
                            s2p1.system(),
                        ),
                    ).toStrictEqual(true);
                } else if (stage === 1) {
                    expect(value.add.length).toStrictEqual(1);
                    expect(value.remove.size).toStrictEqual(0);
                    expect(
                        Models.PublicKey.equal(
                            extractSystem(value.add[0]),
                            s4p1.system(),
                        ),
                    ).toStrictEqual(true);
                } else if (stage === 2) {
                    expect(value.add.length).toStrictEqual(0);
                    expect(value.remove.size).toStrictEqual(1);
                    resolve();
                } else {
                    throw Error('unexpected');
                }

                stage++;
            };

            await s1p1.follow(s2p1.system());
            await s1p1.follow(s3p1.system());

            handle = queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeFollow,
                cb,
            );

            handle.advance(10);

            await s1p1.follow(s4p1.system());
            await s1p1.unfollow(s2p1.system());
        });

        handle?.unregister();

        expect(stage).toStrictEqual(3);
    });

    test('hit disk', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        const s3p1 = await ProcessHandle.createTestProcessHandle();
        const s4p1 = await ProcessHandle.createTestProcessHandle();
        const s5p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = setupQueryManager(s1p1, false, true);

        await s1p1.follow(s2p1.system());
        await s1p1.follow(s3p1.system());
        await s1p1.follow(s4p1.system());
        await s1p1.unfollow(s3p1.system());
        await s1p1.follow(s5p1.system());

        let handle: QueryCRDTSet.QueryHandle | undefined;

        await new Promise<void>(async (resolve) => {
            let stage = 0;

            let state: Array<QueryIndex.Cell> = [];

            function expectState(
                expected: Array<Models.PublicKey.PublicKey | undefined>,
            ) {
                expect(state.length).toStrictEqual(expected.length);

                for (let i = 0; i < expected.length; i++) {
                    const current = expected[i];

                    if (current == undefined) {
                        expect(state[i].signedEvent).toStrictEqual(undefined);
                    } else {
                        expect(
                            Models.PublicKey.equal(
                                current,
                                extractSystem(state[i]),
                            ),
                        ).toStrictEqual(true);
                    }
                }
            }

            const cb = (patch: QueryIndex.CallbackParameters) => {
                if (stage === 0) {
                    state = QueryIndex.applyPatch(state, patch);

                    expectState([s5p1.system(), undefined]);

                    handle?.advance(2);
                } else if (stage === 1) {
                    state = QueryIndex.applyPatch(state, patch);

                    expectState([s5p1.system(), s4p1.system(), undefined]);

                    handle?.advance(2);
                } else if (stage === 2) {
                    state = QueryIndex.applyPatch(state, patch);

                    expectState([s5p1.system(), s4p1.system(), s2p1.system()]);

                    resolve();
                } else {
                    throw Error('unexpected');
                }

                stage++;
            };

            handle = queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeFollow,
                cb,
            );

            handle.advance(2);
        });

        handle?.unregister();
    });
});
