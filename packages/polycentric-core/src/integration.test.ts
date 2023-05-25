import * as FS from 'fs';
import * as Base64 from '@borderless/base64';
import * as ProcessHandle from './process-handle';
import * as MetaStore from './meta-store';
import * as PersistenceDriver from './persistence-driver';
import * as Models from './models';
import * as Synchronization from './synchronization';
import * as Protocol from './protocol';
import * as APIMethods from './api-methods';

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
});
