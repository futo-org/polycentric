import * as ProcessHandle from '../process-handle';
import * as QueryIndex from './query-index';
import * as QueryCRDTSet from './query-crdt-set';
import * as Models from '../models';
import * as Protocol from '../protocol';
import * as Shared from './shared';

function setupQueryManager(
    processHandle: ProcessHandle.ProcessHandle,
    useDisk: boolean,
) {
    const queryIndexManager = new QueryIndex.QueryManager(processHandle);
    queryIndexManager.useNetwork(false);
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

        const queryManager = setupQueryManager(s1p1, false);

        const unregister = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeFollow,
            (value) => {
                throw Error('unexpected');
            },
        );

        unregister();
    });

    test('update during query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        const s3p1 = await ProcessHandle.createTestProcessHandle();
        const s4p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = setupQueryManager(s1p1, true);

        let stage = 0;
        let unregister: Shared.UnregisterCallback | undefined;

        await new Promise<void>(async (resolve) => {
            const cb = (value: QueryIndex.CallbackParameters) => {
                if (stage === 0) {
                    expect(value.add.length).toStrictEqual(2);
                    expect(value.remove.length).toStrictEqual(0);
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
                    expect(value.remove.length).toStrictEqual(0);
                    expect(
                        Models.PublicKey.equal(
                            extractSystem(value.add[0]),
                            s4p1.system(),
                        ),
                    ).toStrictEqual(true);
                } else if (stage === 2) {
                    expect(value.add.length).toStrictEqual(0);
                    expect(value.remove.length).toStrictEqual(1);
                    expect(
                        Models.PublicKey.equal(
                            extractSystem(value.remove[0]),
                            s2p1.system(),
                        ),
                    ).toStrictEqual(true);
                    resolve();
                } else {
                    throw Error('unexpected');
                }

                stage++;
            };

            await s1p1.follow(s2p1.system());
            await s1p1.follow(s3p1.system());

            unregister = queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeFollow,
                cb,
            );

            queryManager.advance(s1p1.system(), cb, 10);

            await s1p1.follow(s4p1.system());
            await s1p1.unfollow(s2p1.system());
        });

        if (unregister) {
            unregister();
        }

        expect(stage).toStrictEqual(3);
    });
});
