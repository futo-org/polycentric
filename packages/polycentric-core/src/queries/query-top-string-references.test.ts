import * as RXJS from 'rxjs';
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import { QueryServers } from './query-servers';
import {
    QueryTopStringReferences,
    queryTopStringReferencesObservable,
} from './query-top-string-references';

function getRandomTopicString() {
    return Math.random().toString(36).substring(2, 10);
}

async function timeout(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

jest.useRealTimers()

describe('query top string references', () => {
    test('query top string references', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(ProcessHandle.TEST_SERVER);
        s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

        const queryServers = new QueryServers(s1p1);
        // random 32 bit string topic
        const topic1 = getRandomTopicString();
        const topic1Buffer = Util.encodeText(topic1);
        const topic1Reference = Models.bufferToReference(topic1Buffer);

        const topic2 = getRandomTopicString();
        const topic2Buffer = Util.encodeText(topic2);
        const topic2Reference = Models.bufferToReference(topic2Buffer);

        await s1p1.post('s1p1', undefined, topic1Reference);
        await s1p1.post('s1p1', undefined, topic1Reference);
        await s1p1.post('s1p1', undefined, topic2Reference);
        await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();

        await timeout(500);
        
        const queryTopStringReferences = new QueryTopStringReferences(
            s1p1,
            queryServers,
            );
            
        const buckets = await RXJS.firstValueFrom(
            queryTopStringReferencesObservable(
                queryTopStringReferences,
                topic1,
            ),
        );

        expect(buckets.length).toBe(1);
        expect(buckets[0].value).toBe(2);
        expect(buckets[0].key).toBe(topic1);

        for (let i = 0; i < 20; i++) {
            const topic = getRandomTopicString();
            const topicBuffer = Util.encodeText(topic);
            const topicReference = Models.bufferToReference(topicBuffer);
            await s1p1.post('joe', undefined, topicReference);
        }

        await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();
        await timeout(500);

        const top10 = await RXJS.firstValueFrom(
            queryTopStringReferencesObservable(queryTopStringReferences),
        );

        expect(top10.length).toBe(10);
    });
});
