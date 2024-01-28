import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import { queryServersObservable, QueryServers } from './query-servers';

describe('QueryServers', () => {
    test('returns address hints', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);
        const queryServers = new QueryServers(s1p1);

        const result = await RXJS.firstValueFrom(
            queryServersObservable(queryServers, s1p1.system()),
        );

        expect(result).toStrictEqual(new Set([ProcessHandle.TEST_SERVER]));
    });

    test('returns from disk', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(ProcessHandle.TEST_SERVER);

        const queryServers = new QueryServers(s1p1);

        const result = await RXJS.firstValueFrom(
            queryServersObservable(queryServers, s1p1.system()),
        );

        expect(result).toStrictEqual(new Set([ProcessHandle.TEST_SERVER]));
    });
});
