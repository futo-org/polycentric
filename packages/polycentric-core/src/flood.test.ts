import * as ProcessHandle from './process-handle';
import * as Synchronization from './synchronization';

const TEST_SERVER_ADDRESS = '127.0.0.1';
const TEST_SERVER = `http://${TEST_SERVER_ADDRESS}:8081`;

describe('flood', () => {
  test('flood', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    await s1p1.addServer(TEST_SERVER);
    for (let i = 0; i < 1000; i++) {
      await s1p1.post(i.toString());
    }
    await Synchronization.backFillServers(s1p1, s1p1.system());
  });
});
