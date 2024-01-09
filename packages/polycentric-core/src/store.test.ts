import Long from 'long';

import * as Store from './store';
import * as PersistenceDriver from './persistence-driver';
import * as Models from './models';
import * as Protocol from './protocol';

describe('store', () => {
    test('ContentTypeUnixMillisecondsSystemProcessClockIndex', async () => {
        const driver = PersistenceDriver.createPersistenceDriverMemory();
        const store = await driver.openStore('');

        const sublevel = store.sublevel('index', {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as PersistenceDriver.BinaryAbstractSubLevel;

        const index = new Store.ContentTypeUnixMillisecondsSystemProcessClockIndex.Index(
            sublevel,
        );

        const query1 = await index.query(
            Models.ContentType.ContentTypePost,
            10,
            undefined,
        );

        expect(query1).toStrictEqual({
            items: [],
            cursor: undefined,
        });

        const privateKey = Models.PrivateKey.random();
        const publicKey = await Models.PrivateKey.derivePublicKey(privateKey);
        const process = Models.Process.random();

        async function makeEvent(
            logicalClock: Long,
            contentType: Models.ContentType.ContentType,
        ): Promise<void> {
            const event = Models.Event.fromProto({
                system: publicKey,
                process: process,
                content: new Uint8Array(),
                logicalClock: logicalClock,
                unixMilliseconds: logicalClock,
                contentType: Models.ContentType.ContentTypePost,
                vectorClock: { logicalClocks: [] },
                indices: { indices: [] },
                references: [],
            });

            const eventBuffer = Protocol.Event.encode(event).finish();

            const signedEvent = Models.SignedEvent.fromProto({
                signature: await Models.PrivateKey.sign(
                    privateKey,
                    eventBuffer,
                ),
                event: eventBuffer,
            });

            await store.batch(index.ingest(signedEvent));
        }

        await makeEvent(Long.fromNumber(1), Models.ContentType.ContentTypePost);
        await makeEvent(Long.fromNumber(2), Models.ContentType.ContentTypePost);
        await makeEvent(Long.fromNumber(3), Models.ContentType.ContentTypePost);

        await makeEvent(Long.fromNumber(1), Models.ContentType.ContentTypeFollow);
        await makeEvent(Long.fromNumber(3), Models.ContentType.ContentTypeFollow);

        await makeEvent(Long.fromNumber(1), Models.ContentType.ContentTypeSystemProcesses);
        await makeEvent(Long.fromNumber(3), Models.ContentType.ContentTypeSystemProcesses);

        const query2 = await index.query(
            Models.ContentType.ContentTypePost,
            1,
            undefined,
        );

        for (const item of query2.items) {
            console.log(item[item.length - 1]);
        }

        const query3 = await index.query(
            Models.ContentType.ContentTypePost,
            10,
            query2.cursor,
        );

        console.log("---");
        for (const item of query3.items) {
            console.log(item[item.length - 1]);
        }



        /*
        expect(query2).toStrictEqual({
            items: [
                Store.makeEventKey(publicKey, process, Long.fromNumber(3)),
                Store.makeEventKey(publicKey, process, Long.fromNumber(2)),
                Store.makeEventKey(publicKey, process, Long.fromNumber(1)),
            ],
            cursor: undefined,
        });
        */

    });
});
