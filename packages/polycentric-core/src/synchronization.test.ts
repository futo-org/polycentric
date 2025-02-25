import * as ProcessHandle from './process-handle';
import * as Util from './util';
import * as Models from './models';

async function waitForEvent(
    processHandle: ProcessHandle.ProcessHandle,
    pointer: Models.Pointer.Pointer,
): Promise<Models.SignedEvent.SignedEvent | undefined> {
    let loadedEvent: Models.SignedEvent.SignedEvent | undefined = undefined;

    for (let i = 0; i < 20 && !loadedEvent; i++) {
        loadedEvent = await processHandle
            .store()
            .indexEvents.getSignedEvent(
                pointer.system,
                pointer.process,
                pointer.logicalClock,
            );

        await Util.sleep(100);
    }

    return loadedEvent;
}

describe('synchronizer', () => {
    test('syncs following', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(ProcessHandle.TEST_SERVER);

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        await s2p1.addServer(ProcessHandle.TEST_SERVER);
        const s2p1Post = await s2p1.post('s2p1');
        await s2p1.synchronizer.debugWaitUntilSynchronizationComplete();

        await s1p1.follow(s2p1.system());
        await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();

        expect(await waitForEvent(s1p1, s2p1Post)).toBeDefined();
    });

    test('loads other devices for self', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(ProcessHandle.TEST_SERVER);
        const s1p1Post = await s1p1.post('s1p1');
        await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();

        const s1p2 =
            await ProcessHandle.testProcessHandleCreateNewProcess(s1p1);
        await s1p2.addServer(ProcessHandle.TEST_SERVER);
        await s1p2.synchronizer.debugWaitUntilSynchronizationComplete();

        expect(await waitForEvent(s1p2, s1p1Post)).toBeDefined();
    });
});
