import * as RXJS from 'rxjs';
import Long from 'long';

import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Protocol from '../protocol';
import { queryEventObservable, QueryEvent } from './query-event2';
import { QueryServers } from './query-servers';
import { CancelContext } from '../cancel-context';

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
    expect(value).toBeDefined();
}

describe('query event2', () => {
    test('hit disk basic', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryServers = new QueryServers(s1p1);
        const queryEvent = new QueryEvent(
            s1p1.store().indexEvents,
            queryServers,
        );
        queryEvent.shouldUseNetwork(false);

        const pointer = await s1p1.post('hello');

        const result = await RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                pointer.system,
                pointer.process,
                pointer.logicalClock,
            ),
        );

        expect(
            Models.Pointer.equal(pointer, Models.signedEventToPointer(result)),
        ).toStrictEqual(true);

        expect(queryEvent.clean).toStrictEqual(true);
    });

    test('hit disk delete', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryServers = new QueryServers(s1p1);
        const queryEvent = new QueryEvent(
            s1p1.store().indexEvents,
            queryServers,
        );
        queryEvent.shouldUseNetwork(false);

        const messagePointer = await s1p1.post('hello');

        const deletePointer = await s1p1.delete(
            messagePointer.process,
            messagePointer.logicalClock,
        );

        expectToBeDefined(deletePointer);

        const messageResult = await RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                messagePointer.system,
                messagePointer.process,
                messagePointer.logicalClock,
            ),
        );

        expect(queryEvent.clean).toStrictEqual(true);

        expect(
            Models.Pointer.equal(
                deletePointer,
                Models.signedEventToPointer(messageResult),
            ),
        ).toStrictEqual(true);

        const deleteResult = await RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                deletePointer.system,
                deletePointer.process,
                deletePointer.logicalClock,
            ),
        );

        expect(
            Models.Pointer.equal(
                deletePointer,
                Models.signedEventToPointer(deleteResult),
            ),
        ).toStrictEqual(true);

        expect(queryEvent.clean).toStrictEqual(true);
    });

    test('delete live', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryServers = new QueryServers(s1p1);
        const queryEvent = new QueryEvent(
            s1p1.store().indexEvents,
            queryServers,
        );
        queryEvent.shouldUseNetwork(false);
        queryEvent.shouldUseDisk(false);

        const startingPointer = await s1p1.post('hello');

        s1p1.setListener((event) => queryEvent.update(event));

        const observablePromise = RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                startingPointer.system,
                startingPointer.process,
                startingPointer.logicalClock.add(Long.UONE),
            ).pipe(RXJS.take(2), RXJS.toArray()),
        );

        const messagePointer = await s1p1.post('to be deleted');

        const deletePointer = await s1p1.delete(
            messagePointer.process,
            messagePointer.logicalClock,
        );

        expectToBeDefined(deletePointer);

        const result = await observablePromise;

        expect(result).toHaveLength(2);

        expect(
            Models.Pointer.equal(
                messagePointer,
                Models.signedEventToPointer(result[0]),
            ),
        ).toStrictEqual(true);

        expect(
            Models.Pointer.equal(
                deletePointer,
                Models.signedEventToPointer(result[1]),
            ),
        ).toStrictEqual(true);

        expect(queryEvent.clean).toStrictEqual(true);
    });

    test('hit network', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

        const messagePointer = await s1p1.post('to be deleted');
        await ProcessHandle.fullSync(s1p1);

        const queryServers = new QueryServers(s1p1);
        const queryEvent = new QueryEvent(
            s1p1.store().indexEvents,
            queryServers,
        );
        queryEvent.shouldUseDisk(false);

        const result = await RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                messagePointer.system,
                messagePointer.process,
                messagePointer.logicalClock,
            ),
        );

        expect(
            Models.Pointer.equal(
                messagePointer,
                Models.signedEventToPointer(result),
            ),
        ).toStrictEqual(true);

        expect(queryEvent.clean).toStrictEqual(true);
    });

    test('context hold', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryServers = new QueryServers(s1p1);
        const queryEvent = new QueryEvent(
            s1p1.store().indexEvents,
            queryServers,
        );
        queryEvent.shouldUseNetwork(false);
        queryEvent.shouldUseDisk(true);

        const contextHold = new CancelContext();

        s1p1.setListener((event) =>
            queryEvent.updateWithContextHold(event, contextHold),
        );

        const pointer = await s1p1.post('hello');

        let wasInstant = false;
        const observable = RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                pointer.system,
                pointer.process,
                pointer.logicalClock,
            ).pipe(
                RXJS.switchMap((signedEvent) => {
                    wasInstant = true;
                    return RXJS.of(signedEvent);
                }),
            ),
        );

        expect(wasInstant).toStrictEqual(true);

        const result = await observable;

        expect(queryEvent.clean).toStrictEqual(false);
        contextHold.cancel();

        expect(
            Models.Pointer.equal(pointer, Models.signedEventToPointer(result)),
        ).toStrictEqual(true);

        expect(queryEvent.clean).toStrictEqual(true);
    });

    test('network queries combined', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

        const queryServers = new QueryServers(s1p1);
        const queryEvent = new QueryEvent(
            s1p1.store().indexEvents,
            queryServers,
        );
        queryEvent.shouldUseDisk(false);

        const e1 = await s1p1.post('one');
        const e2 = await s1p1.post('two');

        let getEventsCalledCount = 0;

        const getEvents = async (
            server: string,
            system: Models.PublicKey.PublicKey,
            ranges: Protocol.RangesForSystem,
        ) => {
            getEventsCalledCount++;

            expect(server).toStrictEqual(ProcessHandle.TEST_SERVER);
            expect(Models.PublicKey.equal(system, s1p1.system())).toStrictEqual(
                true,
            );
            expect(ranges.rangesForProcesses.length).toStrictEqual(1);
            expectToBeDefined(ranges.rangesForProcesses[0].process);
            expect(
                Models.Process.equal(
                    Models.Process.fromProto(
                        ranges.rangesForProcesses[0].process,
                    ),
                    s1p1.process(),
                ),
            ).toStrictEqual(true);
            expect(ranges.rangesForProcesses[0].ranges).toStrictEqual([
                {
                    low: e1.logicalClock,
                    high: e2.logicalClock,
                },
            ]);

            const event1 = await s1p1
                .store()
                .indexEvents.getSignedEvent(
                    e1.system,
                    e1.process,
                    e1.logicalClock,
                );

            expectToBeDefined(event1);

            const event2 = await s1p1
                .store()
                .indexEvents.getSignedEvent(
                    e2.system,
                    e2.process,
                    e2.logicalClock,
                );

            expectToBeDefined(event2);

            return Models.Events.fromProto({
                events: [event1, event2],
            });
        };

        queryEvent.setGetEvents(getEvents);

        await RXJS.firstValueFrom(
            RXJS.combineLatest(
                queryEventObservable(
                    queryEvent,
                    e1.system,
                    e1.process,
                    e1.logicalClock,
                ),
                queryEventObservable(
                    queryEvent,
                    e2.system,
                    e2.process,
                    e2.logicalClock,
                ),
            ),
        );

        expect(getEventsCalledCount).toStrictEqual(1);
        expect(queryEvent.clean).toStrictEqual(true);
    });

    test('instantly cancelled', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

        const queryServers = new QueryServers(s1p1);
        const queryEvent = new QueryEvent(
            s1p1.store().indexEvents,
            queryServers,
        );

        const e1 = await s1p1.post('one');

        queryEventObservable(queryEvent, e1.system, e1.process, e1.logicalClock)
            .subscribe()
            .unsubscribe();

        expect(queryEvent.clean).toStrictEqual(true);
    });
});
