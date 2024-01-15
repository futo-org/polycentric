/* eslint jest/no-conditional-expect: 0 */
import Long from 'long';

import * as ProcessHandle from '../process-handle';
import * as QueryBlob from './query-blob';
import * as Shared from './shared';

const TEST_SERVER = 'http://127.0.0.1:8081';

describe('query blob', () => {
    const testBlob = (() => {
        const blob = new Uint8Array(1024 * 512 * 3);
        blob[0] = 6;
        blob[1024 * 512] = 7;
        blob[1024 * 512 * 2] = 8;
        return blob;
    })();

    test('non existant', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryBlob.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        const unregister = queryManager.query(
            s1p1.system(),
            s1p1.process(),
            [],
            () => {
                throw Error('unexpected');
            },
        );

        unregister();
    });

    test('update during query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryBlob.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        let unregister: Shared.UnregisterCallback | undefined;

        await new Promise<void>(async (resolve) => {
            unregister = queryManager.query(
                s1p1.system(),
                s1p1.process(),
                [
                    {
                        low: Long.fromNumber(1),
                        high: Long.fromNumber(3),
                    },
                ],
                (value) => {
                    expect(value).toStrictEqual(testBlob);
                    resolve();
                },
            );

            await s1p1.publishBlob(testBlob);
        });

        unregister?.();
    });

    test('hit network', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryBlob.QueryManager(s1p1);
        queryManager.useDisk(false);
        s1p1.setListener((event) => queryManager.update(event));

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        await s2p1.addServer(TEST_SERVER);
        await s2p1.publishBlob(testBlob);
        await ProcessHandle.fullSync(s2p1);

        s1p1.addAddressHint(s2p1.system(), TEST_SERVER);

        let unregister: Shared.UnregisterCallback | undefined;

        await new Promise<void>(async (resolve) => {
            unregister = queryManager.query(
                s2p1.system(),
                s2p1.process(),
                [
                    {
                        low: Long.fromNumber(2),
                        high: Long.fromNumber(4),
                    },
                ],
                (value) => {
                    expect(value).toStrictEqual(testBlob);
                    resolve();
                },
            );
        });

        unregister?.();
    });

    test('hit disk', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryBlob.QueryManager(s1p1);
        queryManager.useNetwork(false);

        await s1p1.publishBlob(testBlob);

        s1p1.setListener((event) => queryManager.update(event));

        let unregister: Shared.UnregisterCallback | undefined;

        await new Promise<void>(async (resolve) => {
            unregister = queryManager.query(
                s1p1.system(),
                s1p1.process(),
                [
                    {
                        low: Long.fromNumber(1),
                        high: Long.fromNumber(3),
                    },
                ],
                (value) => {
                    expect(value).toStrictEqual(testBlob);
                    resolve();
                },
            );
        });

        unregister?.();
    });
});
