import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';
import * as QueryServers from './query-servers';

export type Callback = (topReferences: Models.AggregationBucket.Type[]) => void;

export class QueryTopStringReferences {
    private readonly processHandle: ProcessHandle.ProcessHandle;

    private readonly queryServers: QueryServers.QueryServers;

    constructor(
        processHandle: ProcessHandle.ProcessHandle,
        queryServers: QueryServers.QueryServers,
    ) {
        this.processHandle = processHandle;
        this.queryServers = queryServers;
    }

    public query(
        query: string | undefined,
        callback: Callback,
        timeoutMS = 200,
    ) {
        QueryServers.queryServersObservable(
            this.queryServers,
            this.processHandle.system(),
        )
            // Only do this once, this is used for search and we can't have pop-in
            .pipe(RXJS.first())
            .subscribe((servers) => {
                const requestObservables = [...servers].map((server) => {
                    return new RXJS.Observable<Models.ResultTopStringReferences.Type>(
                        (subscriber) => {
                            void APIMethods.getTopStringReferences(
                                server,
                                query,
                            ).then((buckets) => {
                                subscriber.next(buckets);
                                subscriber.complete();
                            });
                        },
                    ).pipe(
                        RXJS.timeout({ first: timeoutMS }),
                        RXJS.catchError(() => RXJS.EMPTY),
                    );
                });

                RXJS.forkJoin(requestObservables).subscribe((responses) => {
                    // for each key, add up all the values and return the top 10
                    const topReferences = new Map<string, number>();

                    for (const response of responses) {
                        for (const bucket of response.buckets) {
                            const count = topReferences.get(bucket.key) ?? 0;
                            topReferences.set(bucket.key, count + bucket.value);
                        }
                    }

                    const sorted = [...topReferences.keys()].sort((a, b) => {
                        // these coalescence ops are useless because we know the keys exist, but eslint doesn't
                        const topA = topReferences.get(a) ?? 0;
                        const topB = topReferences.get(b) ?? 0;
                        return topB - topA;
                    });

                    const topBuckets = sorted.slice(0, 10).map((key) => {
                        return {
                            key,
                            value: Math.ceil(
                                (topReferences.get(key) ?? 0) /
                                    responses.length,
                            ),
                        };
                    });

                    callback(topBuckets);
                });
            });
    }
}

export function queryTopStringReferencesObservable(
    queryManager: QueryTopStringReferences,
    query?: string | undefined,
): RXJS.Observable<Models.AggregationBucket.Type[]> {
    return new RXJS.Observable((subscriber) => {
        queryManager.query(query, (result) => {
            subscriber.next(result);
        });
    });
}
