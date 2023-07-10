/* eslint jest/no-conditional-expect: 0 */

import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as QueryIndex from './query-index';
import * as Synchronization from '../synchronization';
import * as Protocol from '../protocol';

const TEST_SERVER = 'http://127.0.0.1:8081';

async function fullSync(handle: ProcessHandle.ProcessHandle) {
    while (await Synchronization.backFillServers(handle, handle.system())) {}
}

function extractGenericClaim(
    signedEvent: Models.SignedEvent.SignedEvent,
): string {
    const event = Models.Event.fromBuffer(signedEvent.event);

    if (event.contentType.notEquals(Models.ContentType.ContentTypeClaim)) {
        throw Error('expected ContentTypeClaim');
    }

    const claim = Protocol.Claim.decode(event.content);

    if (claim.claimType !== 'Generic') {
        throw Error('expected Generic');
    }

    const identifier = Protocol.ClaimIdentifier.decode(claim.claim);

    return identifier.identifier;
}

describe('query index', () => {
    test('non existant', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryIndex.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        const unregister = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeClaim,
            (value) => {
                throw Error('unexpected');
            },
        );

        unregister();
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

        const unregisterQ1 = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeClaim,
            cb,
        );

        queryManager.advance(s1p1.system(), cb, 10);

        await s1p1.claim(Models.claimGeneric('1'));
        await s1p1.claim(Models.claimGeneric('2'));

        unregisterQ1();

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

        await fullSync(s2p1);

        s1p1.addAddressHint(s2p1.system(), TEST_SERVER);

        let stage = 29;

        await new Promise<void>((resolve) => {
            const cb = (value: QueryIndex.CallbackParameters) => {
                if (stage === 11) {
                    resolve();
                } else if (stage === 21) {
                    expect(extractGenericClaim(value.add[0])).toStrictEqual(
                        '21',
                    );
                    // start the second batch
                    queryManager.advance(s2p1.system(), cb, 10);
                } else {
                    expect(extractGenericClaim(value.add[0])).toStrictEqual(
                        stage.toString(),
                    );
                }

                stage--;
            };

            queryManager.query(
                s2p1.system(),
                Models.ContentType.ContentTypeClaim,
                cb,
            );

            queryManager.advance(s2p1.system(), cb, 10);
        });
    });

    test('hit disk', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryIndex.QueryManager(s1p1);
        queryManager.useNetwork(false);

        await s1p1.claim(Models.claimGeneric('1'));
        await s1p1.claim(Models.claimGeneric('2'));

        let stage = 0;

        await new Promise<void>((resolve) => {
            const cb = (value: QueryIndex.CallbackParameters) => {
                if (stage === 0) {
                    expect(extractGenericClaim(value.add[0])).toStrictEqual(
                        '1',
                    );
                } else if (stage === 1) {
                    expect(extractGenericClaim(value.add[0])).toStrictEqual(
                        '2',
                    );

                    resolve();
                } else {
                    throw Error('unexpected');
                }

                stage++;
            };

            queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeClaim,
                cb,
            );

            queryManager.advance(s1p1.system(), cb, 10);
        });
    });
});
