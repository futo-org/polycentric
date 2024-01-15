/* eslint jest/no-conditional-expect: 0 */
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';
import * as Protocol from '../protocol';
import * as QueryIndex from './query-index';

const TEST_SERVER = 'http://127.0.0.1:8081';

function extractGenericClaim(cell: QueryIndex.Cell): string | undefined {
    if (cell.signedEvent === undefined) {
        return undefined;
    }

    const event = Models.Event.fromBuffer(cell.signedEvent.event);

    if (event.contentType.notEquals(Models.ContentType.ContentTypeClaim)) {
        throw Error('expected ContentTypeClaim');
    }

    const claim = Protocol.Claim.decode(event.content);

    if (claim.claimType.notEquals(Models.ClaimType.ClaimTypeGeneric)) {
        throw Error('expected Generic');
    }

    if (claim.claimFields.length === 0) {
        throw Error('expected claim field');
    }

    return claim.claimFields[0].value;
}

async function copyEventBetweenHandles(
    pointer: Models.Pointer.Pointer,
    from: ProcessHandle.ProcessHandle,
    to: ProcessHandle.ProcessHandle,
): Promise<void> {
    const signedEvent = await from
        .store()
        .getSignedEvent(pointer.system, pointer.process, pointer.logicalClock);

    if (signedEvent === undefined) {
        throw new Error('expected signedEvent');
    }

    await to.ingest(signedEvent);
}

describe('query index', () => {
    test('non existant', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryIndex.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        const handle = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeClaim,
            () => {
                throw Error('unexpected');
            },
        );

        handle.unregister();
    });

    test('update during query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryIndex.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        let stage = 0;

        const cb = (value: QueryIndex.CallbackParameters) => {
            if (stage === 0) {
                expect(extractGenericClaim(value.add[0])).toStrictEqual('1');
            } else if (stage === 1) {
                expect(extractGenericClaim(value.add[0])).toStrictEqual('2');
            } else {
                throw Error('unexpected');
            }

            stage++;
        };

        const handle = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeClaim,
            cb,
        );

        handle.advance(10);

        await s1p1.claim(Models.claimGeneric('1'));
        await s1p1.claim(Models.claimGeneric('2'));

        handle.unregister();

        expect(stage).toStrictEqual(2);
    });

    test('hit network', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryIndex.QueryManager(s1p1);
        queryManager.useDisk(false);
        s1p1.setListener((event) => queryManager.update(event));

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        await s2p1.addServer(TEST_SERVER);

        for (let i = 0; i < 30; i++) {
            await s2p1.claim(Models.claimGeneric(i.toString()));
        }

        await ProcessHandle.fullSync(s2p1);

        s1p1.addAddressHint(s2p1.system(), TEST_SERVER);

        let stage = 0;

        let handle: QueryIndex.QueryHandle | undefined;

        await new Promise<void>((resolve) => {
            const cb = (value: QueryIndex.CallbackParameters) => {
                if (stage === 0) {
                    const got = value.add.map(extractGenericClaim);

                    const expected = [];

                    for (let i = 29; i > 19; i--) {
                        expected.push(i.toString());
                    }

                    expected.push(undefined);

                    expect(got).toStrictEqual(expected);

                    handle?.advance(10);
                } else if (stage === 1) {
                    const got = value.add.map(extractGenericClaim);

                    const expected = [];

                    for (let i = 19; i > 9; i--) {
                        expected.push(i.toString());
                    }

                    expected.push(undefined);

                    expect(got).toStrictEqual(expected);

                    resolve();
                }

                stage++;
            };

            handle = queryManager.query(
                s2p1.system(),
                Models.ContentType.ContentTypeClaim,
                cb,
            );

            handle?.advance(10);
        });

        handle?.unregister();
    });

    test('hit disk', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryIndex.QueryManager(s1p1);
        queryManager.useNetwork(false);

        await s1p1.claim(Models.claimGeneric('1'));
        await s1p1.claim(Models.claimGeneric('2'));
        await s1p1.claim(Models.claimGeneric('3'));
        await s1p1.claim(Models.claimGeneric('4'));
        await s1p1.claim(Models.claimGeneric('5'));
        await s1p1.claim(Models.claimGeneric('6'));

        let stage = 0;

        let handle: QueryIndex.QueryHandle | undefined;

        await new Promise<void>((resolve) => {
            const cb = (value: QueryIndex.CallbackParameters) => {
                if (stage === 0) {
                    expect(value.add.map(extractGenericClaim)).toStrictEqual([
                        '6',
                        '5',
                        undefined,
                    ]);

                    handle?.advance(2);
                } else if (stage === 1) {
                    expect(value.add.map(extractGenericClaim)).toStrictEqual([
                        '4',
                        '3',
                        undefined,
                    ]);

                    handle?.advance(2);
                } else if (stage === 2) {
                    expect(value.add.map(extractGenericClaim)).toStrictEqual([
                        '2',
                        '1',
                    ]);

                    resolve();
                }

                stage++;
            };

            handle = queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeClaim,
                cb,
            );

            handle?.advance(2);
        });

        handle?.unregister();
    });

    test('missing data', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const copyList = [];

        await s1p1.claim(Models.claimGeneric('1'));
        copyList.push(await s1p1.claim(Models.claimGeneric('2')));
        await s1p1.claim(Models.claimGeneric('3'));
        await s1p1.claim(Models.claimGeneric('4'));
        copyList.push(await s1p1.claim(Models.claimGeneric('5')));
        copyList.push(await s1p1.claim(Models.claimGeneric('6')));

        const s2p1 = await ProcessHandle.createTestProcessHandle();

        for (const copy of copyList) {
            await copyEventBetweenHandles(copy, s1p1, s2p1);
        }

        const queryManager = new QueryIndex.QueryManager(s2p1);
        queryManager.useNetwork(false);

        let handle: QueryIndex.QueryHandle | undefined;

        await new Promise<void>((resolve) => {
            const cb = (value: QueryIndex.CallbackParameters) => {
                expect(value.add.map(extractGenericClaim)).toStrictEqual([
                    '6',
                    '5',
                    undefined,
                    '2',
                    undefined,
                ]);

                resolve();
            };

            handle = queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeClaim,
                cb,
            );

            handle.advance(20);
        });

        handle?.unregister();
    });

    test('live delete', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryIndex.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        let handle: QueryIndex.QueryHandle | undefined;
        let state: Array<QueryIndex.Cell> = [];

        await new Promise<void>(async (resolve) => {
            let stage = 0;

            const cb = (patch: QueryIndex.CallbackParameters) => {
                state = QueryIndex.applyPatch(state, patch);
                stage++;

                if (stage === 4) {
                    resolve();
                }
            };

            handle = queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeClaim,
                cb,
            );

            handle.advance(10);

            await s1p1.claim(Models.claimGeneric('1'));
            const secondClaim = await s1p1.claim(Models.claimGeneric('2'));
            await s1p1.claim(Models.claimGeneric('3'));
            await s1p1.delete(secondClaim.process, secondClaim.logicalClock);
        });

        handle?.unregister();

        expect(state.map(extractGenericClaim)).toStrictEqual(['3', '1']);
    });
});
