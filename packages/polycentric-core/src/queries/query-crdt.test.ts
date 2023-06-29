/* eslint jest/no-conditional-expect: 0 */

import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Util from '../util';
import * as QueryCRDT from './query-crdt';
import * as Synchronization from '../synchronization';

const TEST_SERVER = 'http://127.0.0.1:8081';

async function fullSync(handle: ProcessHandle.ProcessHandle) {
    while (await Synchronization.backFillServers(handle, handle.system())) {}
}

describe('query crdt', () => {
    test('non existant', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryCRDT.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        const unregister = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeUsername,
            (value) => {
                throw Error('unexpected');
            },
        );

        unregister();
    });

    test('update during query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryManager = new QueryCRDT.QueryManager(s1p1);
        queryManager.useNetwork(false);
        queryManager.useDisk(false);

        s1p1.setListener((event) => queryManager.update(event));

        let stage = 0;
        const unregisterQ1 = queryManager.query(
            s1p1.system(),
            Models.ContentType.ContentTypeUsername,
            (value) => {
                if (stage === 0) {
                    expect(
                        Util.buffersEqual(value, Util.encodeText('hume')),
                    ).toStrictEqual(true);
                } else if (stage === 1) {
                    expect(
                        Util.buffersEqual(value, Util.encodeText('descartes')),
                    ).toStrictEqual(true);
                } else {
                    throw Error('unexpected');
                }

                stage++;
            },
        );

        await s1p1.setUsername('hume');
        await s1p1.setUsername('descartes');

        unregisterQ1();

        expect(stage).toStrictEqual(2);
    });

    test('hit network', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryCRDT.QueryManager(s1p1);
        queryManager.useDisk(false);
        s1p1.setListener((event) => queryManager.update(event));

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        await s2p1.addServer(TEST_SERVER);
        await s2p1.setUsername('guatarri');
        await fullSync(s2p1);

        s1p1.addAddressHint(s2p1.system(), TEST_SERVER);

        await new Promise<void>((resolve) => {
            queryManager.query(
                s2p1.system(),
                Models.ContentType.ContentTypeUsername,
                (value) => {
                    expect(
                        Util.buffersEqual(value, Util.encodeText('guatarri')),
                    ).toStrictEqual(true);

                    resolve();
                },
            );
        });
    });

    test('hit disk', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryManager = new QueryCRDT.QueryManager(s1p1);
        queryManager.useNetwork(false);

        await s1p1.setUsername('deleuze');

        await new Promise<void>((resolve) => {
            queryManager.query(
                s1p1.system(),
                Models.ContentType.ContentTypeUsername,
                (value) => {
                    expect(
                        Util.buffersEqual(value, Util.encodeText('deleuze')),
                    ).toStrictEqual(true);

                    resolve();
                },
            );
        });
    });
});
