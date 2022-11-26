import * as AbstractLevel from 'abstract-level';
import * as ClassicLevel from 'classic-level';
import Parser from 'rss-parser';
import fetch from 'node-fetch';
import * as FS from 'fs';
import * as XML2JS from 'xml2js';
import * as NodeHTMLParser from 'node-html-parser';

import * as Core from 'polycentric-core';
import * as PolycentricLevelDB from 'polycentric-leveldb';

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function runBot(
    stateDirectoryPath: string,
    profilePicturePath: string,
    username: string,
    description: string,
    feedURL: string,
    handler: (a: Core.DB.PolycentricState, b: any) => Promise<void>,
) {
    const persistenceDriver =
        PolycentricLevelDB.createPersistenceDriverLevelDB(stateDirectoryPath);

    const metaStore = await Core.PersistenceDriver.createMetaStore(
        persistenceDriver,
    );

    const levelRSS = new ClassicLevel.ClassicLevel<string, string>(
        stateDirectoryPath + '/rss',
        {
            keyEncoding: 'utf8',
            valueEncoding: 'utf8',
        },
    );

    const state = await (async () => {
        let levelInfo = await metaStore.getActiveStore();

        if (levelInfo !== undefined) {
            const level = await metaStore.openStore(
                levelInfo.publicKey,
                levelInfo.version,
            );

            const state = new Core.DB.PolycentricState(
                level,
                persistenceDriver,
                'bot',
            );

            await Core.DB.startIdentity(state);

            return state;
        } else {
            const state = await Core.DB.createStateNewIdentity(
                metaStore,
                persistenceDriver,
                'username',
            );

            await Core.DB.startIdentity(state);

            await metaStore.setStoreReady(
                state.identity!.publicKey,
                Core.DB.STORAGE_VERSION,
            );

            await metaStore.setActiveStore(
                state.identity!.publicKey,
                Core.DB.STORAGE_VERSION,
            );

            return state;
        }
    })();

    {
        const message = Core.DB.makeDefaultEventBody();
        message.profile = {
            profileName: new TextEncoder().encode(username),
            profileDescription: new TextEncoder().encode(description),
            profileServers: [],
            profileImagePointer: undefined,
        };

        const servers = ['https://srv1.polycentric.io'];

        for (const server of servers) {
            message.profile?.profileServers.push(
                new TextEncoder().encode(server),
            );
        }

        const image = FS.readFileSync(profilePicturePath, null);

        message.profile!.profileImagePointer = await Core.DB.saveBlob(
            state,
            'image/jpeg',
            image,
        );

        await Core.DB.levelSavePost(state, message);
    }

    let parser = new Parser();

    while (true) {
        let sleepSeconds = 30;

        try {
            console.log('polling feed', feedURL);

            const response = await fetch(feedURL, {
                method: 'GET',
            });

            if (response.status === 429) {
                if (response.headers.has('Retry-After')) {
                    sleepSeconds = Number(response.headers.get('Retry-After'));
                } else {
                    console.log('429 but no Retry-After header');
                }
            }

            if (response.status !== 200) {
                throw new Error('status' + response.status.toString());
            }

            const xml = await response.text();

            let feed = await parser.parseString(xml);

            console.log('feed length', feed.items.length);

            for (const item of feed.items) {
                if (item.guid === undefined) {
                    console.log('no guid');

                    continue;
                }

                try {
                    await levelRSS.get(item.guid);
                    continue;
                } catch (err) {}

                console.log('saving post', item.guid);

                await handler(state, item);

                await levelRSS.put(item.guid, '0');
            }
        } catch (err) {
            console.log(err);
        }

        // console.log("sleeping for", sleepSeconds, "seconds");
        await sleep(1000 * sleepSeconds);
    }
}

async function handlerHackerNews(
    state: Core.DB.PolycentricState,
    item: any,
): Promise<void> {
    const post =
        item.title +
        ' ' +
        'link: ' +
        item.link +
        ' ' +
        'comments: ' +
        item.comments;

    const event = Core.DB.makeDefaultEventBody();
    event.message = {
        message: new TextEncoder().encode(post),
        boostPointer: undefined,
    };

    await Core.DB.levelSavePost(state, event);
}

async function handlerNitter(
    state: Core.DB.PolycentricState,
    item: any,
): Promise<void> {
    if (item.content === undefined) {
        console.log('item content was empty');

        return;
    }

    const parsed = NodeHTMLParser.parse(item.content);

    // console.log(parsed);

    if (parsed.childNodes.length === 0) {
        console.log('no childNodes');

        return;
    }

    let imagePointer: Core.Protocol.Pointer | undefined;
    let message = '';

    const textNodes = parsed.getElementsByTagName('p');

    if (textNodes.length > 0) {
        if (textNodes.length > 1) {
            console.log('more than one text node, using the first one');
        }

        const textNode = textNodes[0];

        if (textNode.childNodes.length !== 0) {
            message = textNode.childNodes[0].rawText;
            console.log('text is:', message);
        } else {
            console.log('text node had no children');
        }
    }

    const imageNodes = parsed.getElementsByTagName('img');

    if (imageNodes.length > 0) {
        if (imageNodes.length > 1) {
            console.log('more than one image node, using last one');
        }

        const imageNode = imageNodes[imageNodes.length - 1];

        const imgURL = imageNode.getAttribute('src');

        if (imgURL === undefined) {
            return;
        }

        console.log('imgURL is', imgURL);

        const imageResponse = await fetch(imgURL, {
            method: 'GET',
        });

        if (imageResponse.status !== 200) {
            console.log('failed downloading image', imageResponse.status);
            return;
        }

        if (!imageResponse.headers.has('Content-Type')) {
            console.log('media did not have content type header');
        }

        const mime = imageResponse.headers.get('Content-Type');

        if (
            mime === undefined ||
            (mime !== 'image/png' && mime !== 'image/jpeg')
        ) {
            console.log('media unexpected mime', mime);
            return;
        }

        const imageRaw = new Uint8Array(await imageResponse.arrayBuffer());

        imagePointer = await Core.DB.saveBlob(state, mime!, imageRaw);
    }

    if (imagePointer === undefined && message === '') {
        return;
    }

    const event = Core.DB.makeDefaultEventBody();
    event.message = {
        message: new TextEncoder().encode(message),
        boostPointer: undefined,
        image: imagePointer,
    };

    await Core.DB.levelSavePost(state, event);
}

runBot(
    'state/ap',
    'ap.jpg',
    'The Associated Press',
    'Advancing the power of facts, globally.',
    'https://nitter.net/ap/rss',
    handlerNitter,
);

runBot(
    'state/biden',
    'biden.jpg',
    'President Biden',
    '46th President of the United States',
    'https://nitter.net/potus/rss',
    handlerNitter,
);

runBot(
    'state/dril',
    'dril.jpg',
    'wint',
    'Societary Fact Whisperer || alienPiss',
    'https://nitter.net/dril/rss',
    handlerNitter,
);

runBot(
    'state/hackernews',
    'hnlogo.jpg',
    'Hacker News Bot',
    'Posting content from the front page of Hacker News',
    'https://hnrss.org/frontpage',
    handlerHackerNews,
);

runBot(
    'state/archillect',
    'archillectlogo.jpg',
    'Archillect',
    'The ocular engine.',
    'https://nitter.net/archillect/rss',
    handlerNitter,
);
