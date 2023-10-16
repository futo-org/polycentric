/* eslint jest/no-conditional-expect: 0 */

import * as ProcessHandle from '../process-handle';
import * as QueryCursor from './query-cursor';
import * as Models from '../models';

function makeResult(
    signedEvents: Array<Models.SignedEvent.SignedEvent>,
    cursor: Uint8Array | undefined,
) {
    return Models.ResultEventsAndRelatedEventsAndCursor.fromProto({
        cursor: cursor,
        resultEvents: {
            events: signedEvents,
        },
        relatedEvents: {
            events: [],
        },
    });
}

describe('query cursor', () => {
    test('no servers', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const server = 'http://localhost.com';

        await s1p1.addServer(server);

        const signedEvents: Array<Models.SignedEvent.SignedEvent> = [];

        for (let i = 0; i < 25; i++) {
            const pointer = await s1p1.post(i.toString());

            const signedEvent = await s1p1
                .store()
                .getSignedEvent(
                    pointer.system,
                    pointer.process,
                    pointer.logicalClock,
                );

            if (signedEvent === undefined) {
                throw new Error('expected signed event');
            }

            signedEvents.push(Models.SignedEvent.fromProto(signedEvent));
        }

        let stage = 0;

        await new Promise<void>(async (resolve) => {
            const loadCallback: QueryCursor.LoadCallback = async (
                server,
                limit,
                cursor,
            ) => {
                expect(limit).toStrictEqual(10);

                if (stage === 0) {
                    expect(cursor).toStrictEqual(undefined);

                    return makeResult(
                        signedEvents.slice(0, 10),
                        new Uint8Array([1]),
                    );
                } else if (stage === 1) {
                    expect(cursor).toStrictEqual(new Uint8Array([1]));

                    return makeResult(
                        signedEvents.slice(10, 20),
                        new Uint8Array([2]),
                    );
                } else if (stage === 2) {
                    expect(cursor).toStrictEqual(new Uint8Array([2]));

                    return makeResult(
                        signedEvents.slice(20),
                        new Uint8Array([2]),
                    );
                } else {
                    expect(cursor).toStrictEqual(new Uint8Array([2]));

                    return makeResult([], new Uint8Array([2]));
                }
            };

            const resultCallback: QueryCursor.ResultCallback = (cells) => {
                if (stage === 0) {
                    expect(cells).toStrictEqual(
                        signedEvents.slice(0, 10).map((signedEvent) => {
                            return {
                                fromServer: server,
                                signedEvent: signedEvent,
                            };
                        }),
                    );

                    stage++;

                    query.advance();
                } else if (stage === 1) {
                    expect(cells).toStrictEqual(
                        signedEvents.slice(10, 20).map((signedEvent) => {
                            return {
                                fromServer: server,
                                signedEvent: signedEvent,
                            };
                        }),
                    );

                    stage++;

                    query.advance();
                } else if (stage === 2) {
                    expect(cells).toStrictEqual(
                        signedEvents.slice(20).map((signedEvent) => {
                            return {
                                fromServer: server,
                                signedEvent: signedEvent,
                            };
                        }),
                    );

                    stage++;

                    resolve();
                } else {
                    throw new Error('unexpected');
                }
            };

            const query = new QueryCursor.Query(
                s1p1,
                loadCallback,
                resultCallback,
                10,
            );

            query.advance();
        });

        expect(stage).toStrictEqual(3);
    });
});
