/* eslint jest/no-conditional-expect: 0 */

import Long from 'long';

import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as QueryHead from './query-head';
import * as Synchronization from '../synchronization';

const TEST_SERVER = 'http://127.0.0.1:8081';

async function fullSync(handle: ProcessHandle.ProcessHandle) {
    while (await Synchronization.backFillServers(handle, handle.system())) {}
}

describe('head', () => {
    test('non existant', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryHead.QueryManager(s1p1);

        s1p1.setListener((event) => queryManager.update(event));

        const unregister = queryManager.query(s1p1.system(), (value) => {
            throw Error('unexpected');
        });

        unregister();
    });

    test('update during query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const s1p1ProcessString = Models.Process.toString(
            s1p1.processSecret().process,
        );

        const queryManager = new QueryHead.QueryManager(s1p1);

        s1p1.setListener((event) => queryManager.update(event));

        let stage = 0;
        const unregisterQ1 = queryManager.query(s1p1.system(), (value) => {
            if (stage === 0) {
                expect(value).toStrictEqual(
                    new Map(
                        Object.entries({
                            [s1p1ProcessString]: Long.fromNumber(1, true),
                        }),
                    ),
                );
            } else if (stage === 1) {
                expect(value).toStrictEqual(
                    new Map(
                        Object.entries({
                            [s1p1ProcessString]: Long.fromNumber(2, true),
                        }),
                    ),
                );
            } else {
                throw Error('unexpected');
            }

            stage++;
        });

        await s1p1.setUsername('tolkien');
        await s1p1.setUsername('defoe');

        // cached results test
        const unregisterQ2 = queryManager.query(s1p1.system(), (value) => {
            expect(value).toStrictEqual(
                new Map(
                    Object.entries({
                        [s1p1ProcessString]: Long.fromNumber(2, true),
                    }),
                ),
            );

            stage++;
        });

        unregisterQ1();
        unregisterQ2();

        expect(stage).toStrictEqual(3);
    });

    test('hit network', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryHead.QueryManager(s1p1);
        s1p1.setListener((event) => queryManager.update(event));

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        await s2p1.addServer(TEST_SERVER);
        await s2p1.setUsername('heinlein');
        await fullSync(s2p1);

        const s2p1ProcessString = Models.Process.toString(
            s2p1.processSecret().process,
        );

        s1p1.addAddressHint(s2p1.system(), TEST_SERVER);

        await new Promise<void>((resolve) => {
            queryManager.query(s2p1.system(), (value) => {
                expect(value).toStrictEqual(
                    new Map(
                        Object.entries({
                            [s2p1ProcessString]: Long.fromNumber(2, true),
                        }),
                    ),
                );

                resolve();
            });
        });
    });
});
