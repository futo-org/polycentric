import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';
import { fromPromiseExceptionToEmpty } from '../util';
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
            .pipe(
                RXJS.first(),
                RXJS.switchMap((servers) => {
                    const requestObservables = [...servers].map((server) => {
                        return fromPromiseExceptionToEmpty(
                            APIMethods.getTopStringReferences(server, query),
                        ).pipe(RXJS.timeout({ first: timeoutMS }));
                    });
                    return RXJS.forkJoin(requestObservables);
                }),
                RXJS.map((responses) => {
                    console.log(responses);
                    const topReferences = new Map<string, number>();
                    responses.forEach((response) => {
                        response.buckets.forEach((bucket) => {
                            const count = topReferences.get(bucket.key) ?? 0;
                            topReferences.set(bucket.key, count + bucket.value);
                        });
                    });
                    return [...topReferences.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                        .map(([key, value]) => ({
                            key,
                            value: Math.ceil(value / responses.length),
                        }));
                }),
            )
            .subscribe((topBuckets) => {
                callback(topBuckets);
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
