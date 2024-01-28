import * as RXJS from 'rxjs';

import Long from 'long';
import * as ProcessHandle from './process-handle';
import * as Models from './models';
import * as Util from './util';
import * as Protocol from './protocol';
import * as Queries from './queries';

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
    expect(value).toBeDefined();
}

describe('processHandle', () => {
    test('basic post', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();

        const events: Array<Models.SignedEvent.SignedEvent> = [];
        processHandle.setListener((event: Models.SignedEvent.SignedEvent) => {
            events.push(event);
        });

        await processHandle.post('jej');
        await processHandle.post('hello world');

        expect(events.length).toStrictEqual(2);

        expect(
            Models.Event.fromBuffer(events[0].event).logicalClock,
        ).toStrictEqual(new Long(1, 0, true));

        expect(
            Models.Event.fromBuffer(events[1].event).logicalClock,
        ).toStrictEqual(new Long(2, 0, true));
    });

    test('addAndRemoveServer', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();

        await processHandle.addServer('http://127.0.0.1');
        await processHandle.addServer('http://127.0.0.2');
        await processHandle.addServer('http://127.0.0.3');
        await processHandle.removeServer('http://127.0.0.1');

        const serverState = await processHandle.loadSystemState(
            processHandle.system(),
        );

        expect(serverState.servers()).toStrictEqual([
            'http://127.0.0.2',
            'http://127.0.0.3',
        ]);
    });

    test('username', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();

        await processHandle.setUsername('alice');
        await processHandle.setUsername('bob');

        const result = await RXJS.firstValueFrom(
            Queries.QueryCRDT2.queryCRDTObservable(
                processHandle.queryManager.queryCRDT,
                processHandle.system(),
                Models.ContentType.ContentTypeUsername,
            ),
        );

        expect(result.potentiallyOutdated).toStrictEqual(false);
        expectToBeDefined(result.value);
        expect(
            Util.buffersEqual(result.value, Util.encodeText('bob')),
        ).toStrictEqual(true);
    });

    test('description', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();

        const description = 'my description';

        await processHandle.setDescription(description);

        const result = await RXJS.firstValueFrom(
            Queries.QueryCRDT2.queryCRDTObservable(
                processHandle.queryManager.queryCRDT,
                processHandle.system(),
                Models.ContentType.ContentTypeDescription,
            ),
        );

        expect(result.potentiallyOutdated).toStrictEqual(false);
        expectToBeDefined(result.value);
        expect(
            Util.buffersEqual(result.value, Util.encodeText(description)),
        ).toStrictEqual(true);
    });

    test('avatar', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();

        const fakeImage = Util.encodeText('not actually a png');

        const imageRanges = await processHandle.publishBlob(fakeImage);

        const imageBundle = {
            imageManifests: [
                {
                    mime: 'image/jpeg',
                    width: Long.fromNumber(512),
                    height: Long.fromNumber(512),
                    byteCount: Long.fromNumber(fakeImage.length),
                    process: processHandle.process(),
                    sections: imageRanges,
                },
            ],
        };

        await processHandle.setAvatar(imageBundle);
    });

    test('claim then vouch', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();

        const claimPointer = await processHandle.claim(
            Models.claimHackerNews('pg'),
        );

        await processHandle.vouch(claimPointer);
    });

    test('delete', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();

        const pointer = await processHandle.post('jej');

        await processHandle.delete(pointer.process, pointer.logicalClock);
    });

    test('following', async () => {
        const processHandle = await ProcessHandle.createTestProcessHandle();
        const subjectHandle = await ProcessHandle.createTestProcessHandle();

        const expectState = async (expected: boolean) => {
            expect(
                await processHandle
                    .store()
                    .indexCRDTElementSet.queryIfAdded(
                        processHandle.system(),
                        Models.ContentType.ContentTypeFollow,
                        Protocol.PublicKey.encode(
                            subjectHandle.system(),
                        ).finish(),
                    ),
            ).toStrictEqual(expected);
        };

        await expectState(false);
        await processHandle.follow(subjectHandle.system());
        await expectState(true);
        await processHandle.unfollow(subjectHandle.system());
        await expectState(false);
    });
});
