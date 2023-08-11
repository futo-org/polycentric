/* eslint jest/no-conditional-expect: 0 */

import Long from 'long';

import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as QueryEvent from './query-event';
import * as Protocol from '../protocol';

const TEST_SERVER = 'http://127.0.0.1:8081';

function extractGenericClaim(
    signedEvent: Models.SignedEvent.SignedEvent,
): string {
    const event = Models.Event.fromBuffer(signedEvent.event);

    if (event.contentType.notEquals(Models.ContentType.ContentTypeClaim)) {
        throw Error('expected ContentTypeClaim');
    }

    const claim = Protocol.Claim.decode(event.content);

    if (claim.claimType.notEquals(Models.ClaimType.ClaimTypeGeneric)) {
        throw Error('expected Generic');
    }

    return claim.claimFields[0]!.value;
}

describe('query event', () => {
    test('non existant', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryEvent.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        const unregister = queryManager.query(
            s1p1.system(),
            s1p1.processSecret().process,
            Long.UZERO,
            (value) => {
                throw Error('unexpected');
            },
        );

        unregister();
    });

    test('update during query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryEvent.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        let stage = 0;

        const cb = (value: Models.SignedEvent.SignedEvent | undefined) => {
            if (stage === 0) {
                expect(extractGenericClaim(value!)).toStrictEqual('1');
            } else if (stage === 1) {
                expect(value).toBeUndefined();
            } else {
                throw Error('unexpected');
            }

            stage++;
        };

        const unregisterQ1 = queryManager.query(
            s1p1.system(),
            s1p1.processSecret().process,
            Long.UONE,
            cb,
        );

        const pointer = await s1p1.claim(Models.claimGeneric('1'));
        await s1p1.delete(pointer.process, pointer.logicalClock);

        unregisterQ1();

        expect(stage).toStrictEqual(2);
    });

    test('hit network', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryEvent.QueryManager(s1p1);
        queryManager.useDisk(false);
        s1p1.setListener((event) => queryManager.update(event));

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        await s2p1.addServer(TEST_SERVER);
        const pointer = await s2p1.claim(Models.claimGeneric('1'));
        await ProcessHandle.fullSync(s2p1);

        s1p1.addAddressHint(s2p1.system(), TEST_SERVER);

        await new Promise<void>((resolve) => {
            const cb = (value: Models.SignedEvent.SignedEvent | undefined) => {
                expect(extractGenericClaim(value!)).toStrictEqual('1');
                resolve();
            };

            queryManager.query(
                pointer.system,
                pointer.process,
                pointer.logicalClock,
                cb,
            );
        });
    });

    test('hit disk', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryEvent.QueryManager(s1p1);
        queryManager.useNetwork(false);
        s1p1.setListener((event) => queryManager.update(event));

        const pointer = await s1p1.claim(Models.claimGeneric('1'));

        await new Promise<void>((resolve) => {
            const cb = (value: Models.SignedEvent.SignedEvent | undefined) => {
                expect(extractGenericClaim(value!)).toStrictEqual('1');
                resolve();
            };

            queryManager.query(
                pointer.system,
                pointer.process,
                pointer.logicalClock,
                cb,
            );
        });
    });
});
