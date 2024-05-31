/* eslint @typescript-eslint/no-non-null-assertion: 0 */

import Long from 'long';

import Sharp from 'sharp';

import * as APIMethods from './api-methods';
import * as Models from './models';
import * as ProcessHandle from './process-handle';
import * as Protocol from './protocol';
import * as Synchronization from './synchronization';
import * as Util from './util';

const TEST_SERVER_ADDRESS = '127.0.0.1';
const TEST_SERVER = `http://${TEST_SERVER_ADDRESS}:8081`;
// const TEST_SERVER = 'https://srv1-stg.polycentric.io';

async function setAvatarImage(
    handle: ProcessHandle.ProcessHandle,
    path: string,
) {
    const resolutions: number[] = [256, 128, 32];

    const imageBundle: Protocol.ImageBundle = {
        imageManifests: [],
    };

    for (const resolution of resolutions) {
        const image = await Sharp(path).resize(resolution).jpeg().toBuffer();

        const imageRanges = await handle.publishBlob(image);

        imageBundle.imageManifests.push({
            mime: 'image/jpeg',
            width: Long.fromNumber(resolution),
            height: Long.fromNumber(resolution),
            byteCount: Long.fromNumber(image.length),
            process: handle.process(),
            sections: imageRanges,
        });
    }

    await handle.setAvatar(imageBundle);
}

async function createHandleWithName(username: string) {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    await s1p1.addServer(TEST_SERVER);
    await s1p1.setUsername(username);
    await Synchronization.backFillServers(s1p1, s1p1.system());
    return s1p1;
}

async function createHandleWithNameAndIdentityHandle(username: string) {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    await s1p1.addServer(TEST_SERVER);
    await s1p1.setUsername(username + '@' + TEST_SERVER_ADDRESS);
    await APIMethods.postClaimHandle(TEST_SERVER, {
        handle: username,
        system: s1p1.system(),
    });
    await Synchronization.backFillServers(s1p1, s1p1.system());
    return s1p1;
}

describe('integration', () => {
    test('resolveAndQuery', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(TEST_SERVER);

        await s1p1.setUsername('Louis Rossmann');
        await s1p1.setDescription('Apple and Apple accesories');

        console.log(
            'rossmann system:' +
                (await ProcessHandle.makeSystemLink(s1p1, s1p1.system())),
        );

        const claimPointer = await s1p1.claim(
            Models.claimGeneric('I Can Lift 4pl8'),
        );

        await s1p1.vouch(claimPointer);

        await s1p1.claim(Models.claimYouTube('@rossmanngroup'));
        await s1p1.claim(Models.claimTwitter('fighttorepair'));
        await s1p1.claim(
            Models.claimBitcoin('1EaEv8DBeFfg6fE6BimEmvEFbYLkhpcvhj'),
        );

        await setAvatarImage(s1p1, './src/rossmann.jpg');

        await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();

        const s2p1 = await ProcessHandle.createTestProcessHandle();
        await s2p1.addServer(TEST_SERVER);

        await s2p1.setUsername('Futo');
        await s2p1.setDescription('Tech Freedom');
        await s2p1.vouch(claimPointer);

        await setAvatarImage(s2p1, './src/futo.jpg');

        await s2p1.synchronizer.debugWaitUntilSynchronizationComplete();

        // console.log('futo system:' + systemToBase64(s2p1.system()));
    });

    test('like', async () => {
        const subject = Models.bufferToReference(
            Util.encodeText('https://fake2.com/' + Math.random().toString()),
        );

        const shamir = await createHandleWithName('shamir');
        const bernstein = await createHandleWithName('bernstein');

        // query likes / dislikes from a server
        const getLikesAndDislikes = async () => {
            const queryReferences = await APIMethods.getQueryReferences(
                TEST_SERVER,
                subject,
                undefined,
                {
                    fromType: Models.ContentType.ContentTypePost,
                    countLwwElementReferences: [],
                    countReferences: [],
                },
                [
                    {
                        fromType: Models.ContentType.ContentTypeOpinion,
                        value: Models.Opinion.OpinionLike,
                    },
                    {
                        fromType: Models.ContentType.ContentTypeOpinion,
                        value: Models.Opinion.OpinionDislike,
                    },
                ],
            );

            expect(queryReferences.counts).toHaveLength(2);

            return {
                likes: queryReferences.counts[0].toNumber(),
                dislikes: queryReferences.counts[1].toNumber(),
            };
        };

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 0,
            dislikes: 0,
        });

        expect(
            Models.Opinion.equal(
                await bernstein
                    .store()
                    .indexOpinion.get(bernstein.system(), subject),
                Models.Opinion.OpinionNeutral,
            ),
        ).toStrictEqual(true);

        await bernstein.opinion(subject, Models.Opinion.OpinionLike);
        await bernstein.synchronizer.debugWaitUntilSynchronizationComplete();

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 1,
            dislikes: 0,
        });

        expect(
            Models.Opinion.equal(
                await bernstein
                    .store()
                    .indexOpinion.get(bernstein.system(), subject),
                Models.Opinion.OpinionLike,
            ),
        ).toStrictEqual(true);

        await shamir.opinion(subject, Models.Opinion.OpinionLike);
        await shamir.synchronizer.debugWaitUntilSynchronizationComplete();

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 2,
            dislikes: 0,
        });

        await bernstein.opinion(subject, Models.Opinion.OpinionDislike);
        await bernstein.synchronizer.debugWaitUntilSynchronizationComplete();

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 1,
            dislikes: 1,
        });

        expect(
            Models.Opinion.equal(
                await bernstein
                    .store()
                    .indexOpinion.get(bernstein.system(), subject),
                Models.Opinion.OpinionDislike,
            ),
        ).toStrictEqual(true);

        await bernstein.opinion(subject, Models.Opinion.OpinionNeutral);
        await bernstein.synchronizer.debugWaitUntilSynchronizationComplete();

        await shamir.opinion(subject, Models.Opinion.OpinionNeutral);
        await shamir.synchronizer.debugWaitUntilSynchronizationComplete();

        expect(await getLikesAndDislikes()).toStrictEqual({
            likes: 0,
            dislikes: 0,
        });

        expect(
            Models.Opinion.equal(
                await bernstein
                    .store()
                    .indexOpinion.get(bernstein.system(), subject),
                Models.Opinion.OpinionNeutral,
            ),
        ).toStrictEqual(true);
    });

    test('censor', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(TEST_SERVER);

        const postContent = 'I fought the law, and the law won';
        await s1p1.post(postContent);

        const post = await s1p1.post(postContent);
        const censorSystem = await ProcessHandle.makeSystemLink(
            s1p1,
            s1p1.system(),
        );
        await APIMethods.postCensor(
            TEST_SERVER,
            Models.CensorshipType.DoNotRecommend,
            `https://localhost:8081/profile/${censorSystem}`,
            '123',
        );

        const censorEvent = await ProcessHandle.makeEventLink(
            s1p1,
            s1p1.system(),
            post,
        );
        await APIMethods.postCensor(
            TEST_SERVER,
            Models.CensorshipType.DoNotRecommend,
            `https://localhost:8081/post/${censorEvent}`,
            '123',
        );
    });

    test('search', async () => {
        function eventToContent(event: Uint8Array): string {
            const decodedEvent = Models.Event.fromBuffer(event);
            const post = Protocol.Post.decode(decodedEvent.content);
            if (post.content === undefined) {
                throw new Error('Post content was undefined');
            }
            return post.content;
        }

        function lwwEventToContent(event: Uint8Array): string {
            const decodedEvent = Models.Event.fromBuffer(event);
            if (decodedEvent.lwwElement === undefined) {
                throw new Error('LWW Element was undefined');
            }
            return Util.decodeText(decodedEvent.lwwElement.value);
        }

        function getAndCheckFirstEvent(
            searchResults: Protocol.ResultEventsAndRelatedEventsAndCursor,
        ): Uint8Array {
            const resultEvents = searchResults.resultEvents;
            if (resultEvents === undefined) {
                throw new Error('ResultEvents was undefined');
            }
            const events = resultEvents.events;
            expect(events.length).toBeGreaterThan(0);
            const signedEvent = events[0];
            return signedEvent.event;
        }

        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(TEST_SERVER);

        const username = (Math.random() * 100000).toString();
        const description = 'Alerts for many rail lines';
        const newUsername =
            'South Eastern Pennsylvania Transportation Authority';
        await s1p1.setDescription(description);
        await s1p1.setUsername(newUsername);

        const post1Content =
            'The Manayunk/Norristown line is delayed 15 minutes due to trackwork';
        const post2Content =
            'All trains are on a reduced schedule due to single-tracking at Jefferson station';
        const post3Content = (Math.random() * 100000).toString();
        await s1p1.post(post1Content);
        await s1p1.post(post2Content);

        for (let i = 0; i < 11; i++) {
            await s1p1.post(post3Content);
        }

        await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();

        // give opensearch time to index everything
        await new Promise((r) => setTimeout(r, 5000));

        const post1SearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Manayunk',
        );
        const post1SearchContent = eventToContent(
            getAndCheckFirstEvent(post1SearchResults),
        );
        expect(post1SearchContent).toBe(post1Content);

        const post2SearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Thomas Jefferson',
        );
        const post2SearchContent = eventToContent(
            getAndCheckFirstEvent(post2SearchResults),
        );
        expect(post2SearchContent).toBe(post2Content);

        const post3SearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            post3Content,
        );
        const post3SearchContent = eventToContent(
            getAndCheckFirstEvent(post3SearchResults),
        );
        expect(post3SearchContent).toBe(post3Content);
        expect(post3SearchResults.resultEvents.events.length).toBe(10);

        if (post3SearchResults.cursor === undefined) {
            throw new Error('post3SearchResults.cursor is undefined');
        }

        const post3ReSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            post3Content,
            25,
            post3SearchResults.cursor,
        );
        expect(post3ReSearchResults.resultEvents.events.length).toBe(1);

        const usernameSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Pennsylvania',
            undefined,
            undefined,
            APIMethods.SearchType.Profiles,
        );
        const usernameSearchContent = lwwEventToContent(
            getAndCheckFirstEvent(usernameSearchResults),
        );
        expect(usernameSearchContent).toBe(newUsername);

        const oldUsernameSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            username,
            undefined,
            undefined,
            APIMethods.SearchType.Profiles,
        );
        expect(oldUsernameSearchResults.resultEvents.events.length).toBe(0);

        const descriptionSearchResults = await APIMethods.getSearch(
            TEST_SERVER,
            'Alerts',
            undefined,
            undefined,
            APIMethods.SearchType.Profiles,
        );
        const descriptionSearchContent = lwwEventToContent(
            getAndCheckFirstEvent(descriptionSearchResults),
        );
        expect(descriptionSearchContent).toBe(description);
    }, 10000);

    test('purge', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        await s1p1.addServer(TEST_SERVER);

        const challenge = await APIMethods.getChallenge(TEST_SERVER);

        const solvedChallenge = await ProcessHandle.solveChallenge(
            s1p1,
            challenge,
        );

        await APIMethods.postPurge(TEST_SERVER, solvedChallenge);
    });

    test('query multiple references', async () => {
        const primaryReference = Models.bufferToReference(
            Util.encodeText('https://fake.com/' + Math.random().toString()),
        );

        const secondaryReferenceBytes = Util.encodeText(
            'https://fake.com/' + Math.random().toString(),
        );

        const secondaryReference = Models.bufferToReference(
            secondaryReferenceBytes,
        );

        const s1 = await ProcessHandle.createTestProcessHandle();
        await s1.addServer(TEST_SERVER);
        const post1 = await s1.post('a', undefined, primaryReference);
        await s1.opinion(primaryReference, Models.Opinion.OpinionLike);
        await s1.synchronizer.debugWaitUntilSynchronizationComplete();

        const s2 = await ProcessHandle.createTestProcessHandle();
        await s2.addServer(TEST_SERVER);
        const post2 = await s2.post('b', undefined, secondaryReference);
        await s2.opinion(secondaryReference, Models.Opinion.OpinionDislike);
        await s2.synchronizer.debugWaitUntilSynchronizationComplete();

        const result = await APIMethods.getQueryReferences(
            TEST_SERVER,
            primaryReference,
            undefined,
            {
                fromType: Models.ContentType.ContentTypePost,
                countLwwElementReferences: [],
                countReferences: [],
            },
            [
                {
                    fromType: Models.ContentType.ContentTypeOpinion,
                    value: Models.Opinion.OpinionLike,
                },
                {
                    fromType: Models.ContentType.ContentTypeOpinion,
                    value: Models.Opinion.OpinionDislike,
                },
            ],
            [
                {
                    fromType: Models.ContentType.ContentTypePost,
                },
            ],
            [secondaryReferenceBytes],
        );

        // likes
        expect(result.counts[0].toNumber()).toStrictEqual(1);
        // dislikes
        expect(result.counts[1].toNumber()).toStrictEqual(1);
        // reply count
        expect(result.counts[2].toNumber()).toStrictEqual(2);

        expect(result.items).toHaveLength(2);

        expect(
            Models.Pointer.equal(
                post2,
                Models.signedEventToPointer(
                    Models.SignedEvent.fromProto(result.items[0].event!),
                ),
            ),
        ).toStrictEqual(true);

        expect(
            Models.Pointer.equal(
                post1,
                Models.signedEventToPointer(
                    Models.SignedEvent.fromProto(result.items[1].event!),
                ),
            ),
        ).toStrictEqual(true);
    });

    test('claim and search identity handles', async () => {
        // Test regular behavior
        const contoso =
            await createHandleWithNameAndIdentityHandle('contoso-1');
        const contoso2 =
            await createHandleWithNameAndIdentityHandle('contoso-2');
        const osotnoc =
            await createHandleWithNameAndIdentityHandle('osotnoc_corp');

        await contoso.synchronizer.debugWaitUntilSynchronizationComplete();
        await osotnoc.synchronizer.debugWaitUntilSynchronizationComplete();

        const result_contoso = await APIMethods.getResolveHandle(
            TEST_SERVER,
            'contoso-1',
        );
        expect(result_contoso).toStrictEqual(contoso.system());

        const result_contoso2 = await APIMethods.getResolveHandle(
            TEST_SERVER,
            'contoso-2',
        );
        expect(result_contoso2).toStrictEqual(contoso2.system());

        const result_osotnoc = await APIMethods.getResolveHandle(
            TEST_SERVER,
            'osotnoc_corp',
        );
        expect(result_osotnoc).toStrictEqual(osotnoc.system());

        // Duplicate entry for system
        await APIMethods.postClaimHandle(TEST_SERVER, {
            handle: 'contoso-3',
            system: contoso2.system(),
        });

        const result_contoso3 = await APIMethods.getResolveHandle(
            TEST_SERVER,
            'contoso-3',
        );
        expect(result_contoso3).toStrictEqual(contoso2.system());

        // Name with restricted chars
        let creation_failed = true;
        try {
            await APIMethods.postClaimHandle(TEST_SERVER, {
                handle: 'This has spaces, dollar $ign$, and an &mpersand. not allowed!!',
                system: contoso.system(),
            });
            creation_failed = false;
        } catch {}
        expect(creation_failed).toStrictEqual(true);

        // Name that's too long
        creation_failed = true;
        try {
            await APIMethods.postClaimHandle(TEST_SERVER, {
                handle: '01234567890123456789012345678901234567890123456789012345678901234',
                system: contoso.system(),
            });
            creation_failed = false;
        } catch {}
        expect(creation_failed).toStrictEqual(true);

        // Name that's already taken
        const contosoCopycat = await createHandleWithName('contoso-1');
        creation_failed = true;
        try {
            await APIMethods.postClaimHandle(TEST_SERVER, {
                handle: 'contoso-1',
                system: contosoCopycat.system(),
            });
            creation_failed = false;
        } catch {}
        expect(creation_failed).toStrictEqual(true);
    });
});
