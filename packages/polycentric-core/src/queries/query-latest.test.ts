import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { QueryServers } from './query-servers';
import { QueryHead } from './query-head';
import { QueryLatest, queryLatestObservable } from './query-latest';
import { CancelContext } from '../cancel-context';

enum SharedTestMode {
    NetworkOnly,
    DiskOnly,
    CacheOnly,
}

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
    expect(value).toBeDefined();
}

async function sharedTestCase(mode: SharedTestMode): Promise<void> {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

    const queryServers = new QueryServers(s1p1);
    const queryHead = new QueryHead(s1p1, queryServers);
    queryHead.shouldUseNetwork(false);
    queryHead.shouldUseDisk(false);

    const queryLatest = new QueryLatest(
        s1p1.store().indexSystemProcessContentTypeLogicalClock,
        queryServers,
        queryHead,
    );
    queryLatest.shouldUseNetwork(false);
    queryLatest.shouldUseDisk(false);

    if (mode === SharedTestMode.NetworkOnly) {
        queryHead.shouldUseNetwork(true);
        queryLatest.shouldUseNetwork(true);
    } else if (mode === SharedTestMode.DiskOnly) {
        queryHead.shouldUseDisk(true);
        queryLatest.shouldUseDisk(true);
    }

    const contextHold =
        mode === SharedTestMode.CacheOnly ? new CancelContext() : undefined;

    if (mode === SharedTestMode.CacheOnly) {
        s1p1.setListener((event) => {
            queryHead.updateWithContextHold(event, contextHold);
            queryLatest.updateWithContextHold(event, contextHold);
        });
    }

    const pointer = await s1p1.post('hello');

    if (mode === SharedTestMode.NetworkOnly) {
        await ProcessHandle.fullSync(s1p1);
    }

    let wasInstant = false;
    const observable = RXJS.firstValueFrom(
        queryLatestObservable(
            queryLatest,
            pointer.system,
            Models.ContentType.ContentTypePost,
        ).pipe(
            RXJS.switchMap((head) => {
                wasInstant = true;
                return RXJS.of(head);
            }),
        ),
    );

    expect(wasInstant).toStrictEqual(mode === SharedTestMode.CacheOnly);

    const result = Util.mapOverMap(
        await observable,
        Models.signedEventToPointer,
    );

    if (contextHold) {
        expect(queryLatest.clean).toStrictEqual(false);

        contextHold.cancel();
    }

    const expected = new Map([
        [Models.Process.toString(pointer.process), pointer],
    ]);

    expect(
        Util.areMapsEqual(result, expected, Models.Pointer.equal),
    ).toStrictEqual(true);

    expect(queryLatest.clean).toStrictEqual(true);

    if (mode !== SharedTestMode.CacheOnly) {
        const dualQueryResult = await RXJS.firstValueFrom(
            RXJS.combineLatest(
                queryLatestObservable(
                    queryLatest,
                    s1p1.system(),
                    Models.ContentType.ContentTypePost,
                ),
                queryLatestObservable(
                    queryLatest,
                    s1p1.system(),
                    Models.ContentType.ContentTypePost,
                ),
            ),
        );

        expect(dualQueryResult[0] === dualQueryResult[1]).toStrictEqual(true);

        expect(queryLatest.clean).toStrictEqual(true);
    }

    queryLatestObservable(
        queryLatest,
        s1p1.system(),
        Models.ContentType.ContentTypeUsername,
    )
        .subscribe()
        .unsubscribe();

    expect(queryLatest.clean).toStrictEqual(true);
}

describe('query latest', () => {
    test('hit disk', async () => {
        await sharedTestCase(SharedTestMode.DiskOnly);
    });

    test('hit network', async () => {
        await sharedTestCase(SharedTestMode.NetworkOnly);
    });

    test('context hold', async () => {
        await sharedTestCase(SharedTestMode.CacheOnly);
    });

    test('never set', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const queryServers = new QueryServers(s1p1);
        const queryHead = new QueryHead(s1p1, queryServers);
        queryHead.shouldUseNetwork(false);
        const queryLatest = new QueryLatest(
            s1p1.store().indexSystemProcessContentTypeLogicalClock,
            queryServers,
            queryHead,
        );
        queryLatest.shouldUseNetwork(false);

        const result = await RXJS.firstValueFrom(
            queryLatestObservable(
                queryLatest,
                s1p1.system(),
                Models.ContentType.ContentTypeUsername,
            ),
        );

        expect(result.size).toStrictEqual(0);

        expect(queryLatest.clean).toStrictEqual(true);

        const dualQueryResult = await RXJS.firstValueFrom(
            RXJS.combineLatest(
                queryLatestObservable(
                    queryLatest,
                    s1p1.system(),
                    Models.ContentType.ContentTypeUsername,
                ),
                queryLatestObservable(
                    queryLatest,
                    s1p1.system(),
                    Models.ContentType.ContentTypeUsername,
                ),
            ),
        );

        expect(dualQueryResult[0] === dualQueryResult[1]).toStrictEqual(true);

        expect(queryLatest.clean).toStrictEqual(true);
    });

    test('network queries combined', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

        const queryServers = new QueryServers(s1p1);
        const queryHead = new QueryHead(s1p1, queryServers);
        queryHead.shouldUseDisk(false);
        const queryLatest = new QueryLatest(
            s1p1.store().indexSystemProcessContentTypeLogicalClock,
            queryServers,
            queryHead,
        );
        queryLatest.shouldUseDisk(false);

        const usernamePointer = await s1p1.setUsername('Laozi');
        const descriptionPointer = await s1p1.setDescription('daodejing');

        const usernameEvent = await s1p1
            .store()
            .indexEvents.getSignedEvent(
                usernamePointer.system,
                usernamePointer.process,
                usernamePointer.logicalClock,
            );

        expectToBeDefined(usernameEvent);

        const descriptionEvent = await s1p1
            .store()
            .indexEvents.getSignedEvent(
                descriptionPointer.system,
                descriptionPointer.process,
                descriptionPointer.logicalClock,
            );

        expectToBeDefined(descriptionEvent);

        let getQueryLatestCalledCount = 0;

        const getQueryLatest = async (
            server: string,
            system: Models.PublicKey.PublicKey,
            contentTypes: ReadonlyArray<Models.ContentType.ContentType>,
        ) => {
            getQueryLatestCalledCount++;

            expect(server).toStrictEqual(ProcessHandle.TEST_SERVER);

            expect(Models.PublicKey.equal(system, s1p1.system())).toStrictEqual(
                true,
            );

            expect(
                Util.areSetsEqual(
                    new Set(contentTypes),
                    new Set([
                        Models.ContentType.ContentTypeUsername,
                        Models.ContentType.ContentTypeDescription,
                        Models.ContentType.ContentTypeAvatar,
                    ]),
                    Models.ContentType.equal,
                ),
            );

            return Models.Events.fromProto({
                events: [usernameEvent, descriptionEvent],
            });
        };

        queryLatest.setGetQueryLatest(getQueryLatest);

        await RXJS.firstValueFrom(
            RXJS.combineLatest(
                queryLatestObservable(
                    queryLatest,
                    s1p1.system(),
                    Models.ContentType.ContentTypeUsername,
                ),
                queryLatestObservable(
                    queryLatest,
                    s1p1.system(),
                    Models.ContentType.ContentTypeDescription,
                ),
                queryLatestObservable(
                    queryLatest,
                    s1p1.system(),
                    Models.ContentType.ContentTypeAvatar,
                ),
            ),
        );

        expect(getQueryLatestCalledCount).toStrictEqual(1);
        expect(queryLatest.clean).toStrictEqual(true);
    });
});
