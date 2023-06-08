import * as FS from 'fs';
import * as Base64 from '@borderless/base64';
import * as ProcessHandle from './process-handle';
import * as MetaStore from './meta-store';
import * as PersistenceDriver from './persistence-driver';
import * as Models from './models';
import * as Synchronization from './synchronization';
import * as Protocol from './protocol';
import * as APIMethods from './api-methods';
import * as Util  from './util';

export async function createProcessHandle(): Promise<ProcessHandle.ProcessHandle> {
    return await ProcessHandle.createProcessHandle(
        await MetaStore.createMetaStore(
            PersistenceDriver.createPersistenceDriverMemory(),
        ),
    );
}

describe('integration', () => {
    test('sync', async () => {
        const s1p1 = await createProcessHandle();
        await s1p1.addServer('http://127.0.0.1:8081');
        await s1p1.setDescription('hello');

        const claim = Models.claimHackerNews('pg');

        const claimPointer = await s1p1.claim(claim);
        await s1p1.vouch(claimPointer);

        await Synchronization.backFillServers(s1p1, s1p1.system());

        const s2p1 = await createProcessHandle();

        while (
            await Synchronization.backfillClient(
                s2p1,
                s1p1.system(),
                'http://127.0.0.1:8081',
            )
        ) {}

        const s1State = await s2p1.loadSystemState(s1p1.system());

        expect(s1State.description()).toStrictEqual('hello');

        const resolved = await APIMethods.getResolveClaim(
            'http://localhost:8081',
            s1p1.system(),
            claim,
        );

        expect(resolved.events.length).toStrictEqual(2);
    });

    test('resolveAndQuery', async () => {
        const s1p1 = await createProcessHandle();
        await s1p1.addServer('http://127.0.0.1:8081');

        await s1p1.setUsername('Louis Rossmann');
        await s1p1.setDescription('Apple and Apple accesories');

        function systemToBase64(system: Models.PublicKey.PublicKey): string {
            return Base64.encodeUrl(Protocol.PublicKey.encode(system).finish());
        }

        console.log('rossmann system:' + systemToBase64(s1p1.system()));

        const claimPointer = await s1p1.claim(
            Models.claimGeneric('I Can Lift 4pl8'),
        );

        await s1p1.vouch(claimPointer);

        await s1p1.claim(Models.claimYouTube('@rossmanngroup'));
        await s1p1.claim(Models.claimTwitter('fighttorepair'));
        await s1p1.claim(
            Models.claimBitcoin('1EaEv8DBeFfg6fE6BimEmvEFbYLkhpcvhj'),
        );

        {
            const image = FS.readFileSync('./src/rossmann.jpg', null);
            const imagePointer = await s1p1.publishBlob('image/jpeg', image);
            await s1p1.setAvatar(imagePointer);
        }

        await Synchronization.backFillServers(s1p1, s1p1.system());

        const s2p1 = await createProcessHandle();
        await s2p1.addServer('http://127.0.0.1:8081');

        await s2p1.setUsername('Futo');
        await s2p1.setDescription('Tech Freedom');

        await s2p1.vouch(claimPointer);

        {
            const image = FS.readFileSync('./src/futo.jpg', null);
            const imagePointer = await s2p1.publishBlob('image/jpeg', image);
            await s2p1.setAvatar(imagePointer);
        }

        await Synchronization.backFillServers(s2p1, s2p1.system());

        console.log('futo system:' + systemToBase64(s2p1.system()));

        /*
        const resolvedClaim = (await APIMethods.getResolveClaim(
            'http://localhost:8081',
            s1p1.system(),
            claim,
        )).events.map((proto) =>
            Models.eventFromProtoBuffer(
                Models.signedEventFromProto(proto).event()
            )
        ).find((event) =>
            event.contentType().equals(new Long(Models.ContentType.Claim))
        );

        expect(resolvedClaim).toBeDefined();

        const s2p1 = await createProcessHandle();

        await Synchronization.saveBatch(
            s2p1,
            await APIMethods.getQueryIndex(
                'http://localhost:8081',
                resolvedClaim!.system(),
                [
                    new Long(Models.ContentType.Description),
                ],
                undefined,
            ),
        );

        const systemState = await s2p1.loadSystemState(
            resolvedClaim!.system(),
        );
        */
    });

    test('search', async () => {
        function eventToContent(event: Uint8Array): string {
            let decodedEvent = Models.Event.fromBuffer(event);
            let post = Protocol.Post.decode(decodedEvent.content);
            if (post.content === undefined) {
                throw new Error('Post content was undefined');
            }
            return post.content;
        }

        function lwwEventToContent(event: Uint8Array): string {
            let decodedEvent = Models.Event.fromBuffer(event);
            if (decodedEvent.lwwElement === undefined) {
                throw new Error('LWW Element was undefined');
            }
            return Util.decodeText(decodedEvent.lwwElement.value);
        }

        function getAndCheckFirstEvent(
            searchResults: Protocol.ResultEventsAndRelatedEventsAndCursor,
        ): Uint8Array {
            let resultEvents = searchResults.resultEvents;
            if (resultEvents === undefined) {
                throw new Error('ResultEvents was undefined');
            }
            let events = resultEvents.events;
            expect(events.length).toBeGreaterThan(0);
            let signedEvent = events[0];
            return signedEvent.event;
        }

        const s1p1 = await createProcessHandle();
        await s1p1.addServer('http://127.0.0.1:8081');

        let username = Math.random() * 100000 + '';
        let description = 'Alerts for many rail lines';
        let newUsername = 'South Eastern Pennsylvania Transportation Authority';
        await s1p1.setDescription(description);
        await s1p1.setUsername(newUsername);

        let post1Content =
            'The Manayunk/Norristown line is delayed 15 minutes due to trackwork';
        let post2Content =
            'All trains are on a reduced schedule due to single-tracking at Jefferson station';
        await s1p1.post(post1Content);
        await s1p1.post(post2Content);
        await Synchronization.backFillServers(s1p1, s1p1.system());

        // give opensearch time to index everything
        await new Promise((r) => setTimeout(r, 5000));

        let post1SearchResults = await APIMethods.getSearch(
            'http://127.0.0.1:8081',
            'Manayunk',
        );
        let post1SearchContent = eventToContent(
            getAndCheckFirstEvent(post1SearchResults),
        );
        expect(post1SearchContent).toBe(post1Content);

        let post2SearchResults = await APIMethods.getSearch(
            'http://127.0.0.1:8081',
            'Thomas Jefferson',
        );
        let post2SearchContent = eventToContent(
            getAndCheckFirstEvent(post2SearchResults),
        );
        expect(post2SearchContent).toBe(post2Content);

        let usernameSearchResults = await APIMethods.getSearch(
            'http://127.0.0.1:8081',
            'Pennsylvania',
        );
        let usernameSearchContent = lwwEventToContent(
            getAndCheckFirstEvent(usernameSearchResults),
        );
        expect(usernameSearchContent).toBe(newUsername);

        let oldUsernameSearchResults = await APIMethods.getSearch(
            'http://127.0.0.1:8081',
            username,
        );
        expect(oldUsernameSearchResults.resultEvents?.events.length).toBe(0);

        let descriptionSearchResults = await APIMethods.getSearch(
            'http://127.0.0.1:8081',
            'Alerts',
        );
        let descriptionSearchContent = lwwEventToContent(
            getAndCheckFirstEvent(descriptionSearchResults),
        );
        expect(descriptionSearchContent).toBe(description);
    }, 10000);
});
