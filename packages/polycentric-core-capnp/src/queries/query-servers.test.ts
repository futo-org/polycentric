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

    expect(queryServers.clean).toStrictEqual(true);
  });

  test('returns from disk', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    await s1p1.addServer(ProcessHandle.TEST_SERVER);

    const queryServers = new QueryServers(s1p1);

    const result = await RXJS.firstValueFrom(
      queryServersObservable(queryServers, s1p1.system()),
    );

    expect(result).toStrictEqual(new Set([ProcessHandle.TEST_SERVER]));

    expect(queryServers.clean).toStrictEqual(true);
  });

  test('dual queries return same cached result', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    await s1p1.addServer(ProcessHandle.TEST_SERVER);

    const queryServers = new QueryServers(s1p1);

    const dualQueryResult = await RXJS.firstValueFrom(
      RXJS.combineLatest(
        queryServersObservable(queryServers, s1p1.system()),
        queryServersObservable(queryServers, s1p1.system()),
      ),
    );

    expect(dualQueryResult[0] === dualQueryResult[1]).toStrictEqual(true);

    expect(queryServers.clean).toStrictEqual(true);
  });

  test('instantly cancelled', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

    const queryServers = new QueryServers(s1p1);

    queryServersObservable(queryServers, s1p1.system())
      .subscribe()
      .unsubscribe();

    expect(queryServers.clean).toStrictEqual(true);
  });
});
