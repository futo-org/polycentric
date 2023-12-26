import * as AbstractLevel from 'abstract-level';
import * as ClassicLevel from 'classic-level';
import Parser from 'rss-parser';
import fetch from 'node-fetch';
import * as FS from 'fs';
import * as NodeHTMLParser from 'node-html-parser';

import * as Core from '@polycentric/polycentric-core';

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
    handler: (a: Core.ProcessHandle.ProcessHandle, b: any) => Promise<void>,
) {
    const persistenceDriver =
        Core.PersistenceDriver.createPersistenceDriverMemory();

    const metaStore = await Core.MetaStore.createMetaStore(persistenceDriver);

    const levelRSS = new ClassicLevel.ClassicLevel<string, string>(
        stateDirectoryPath + '/rss',
        {
            keyEncoding: 'utf8',
            valueEncoding: 'utf8',
        },
    );

    const processHandle =
        await Core.ProcessHandle.createProcessHandle(metaStore);

    {
        const servers = process.env.POLYCENTRIC_SERVERS?.split(',') ?? [];

        const image = FS.readFileSync(profilePicturePath, null);
        const imagePointer = await processHandle.publishBlob(
            'image/jpeg',
            image,
        );

        processHandle.setUsername(username);
        processHandle.setDescription(description);
        processHandle.setAvatar(imagePointer);
        for (const server of servers) {
            processHandle.addServer(server);
        }
    }

    let parser = new Parser();

    while (true) {
        let sleepSeconds = 30;

        try {
            console.info('polling feed', feedURL);

            const response = await fetch(feedURL, {
                method: 'GET',
            });

            if (response.status === 429) {
                if (response.headers.has('Retry-After')) {
                    sleepSeconds = Number(response.headers.get('Retry-After'));
                } else {
                    console.warn('429 but no Retry-After header');
                }
            }

            if (response.status !== 200) {
                throw new Error(
                    `status ${response.status.toString()} for ${feedURL}: ${await response.text()}`,
                );
            }

            const xml = await response.text();

            let feed = await parser.parseString(xml);

            console.info('feed length', feed.items.length);

            for (const item of feed.items) {
                if (item.guid === undefined) {
                    console.warn('no guid');
                    continue;
                }

                try {
                    await levelRSS.get(item.guid);
                    continue;
                } catch (err) {}

                console.info('saving post', item.guid);

                await handler(processHandle, item);

                await levelRSS.put(item.guid, '0');
            }
        } catch (err) {
            console.warn(err);
        }

        // console.info("sleeping for", sleepSeconds, "seconds");
        await sleep(1000 * sleepSeconds);
    }
}

async function handlerHackerNews(
    processHandle: Core.ProcessHandle.ProcessHandle,
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

    await processHandle.post(post);
}

async function handlerNitter(
    processHandle: Core.ProcessHandle.ProcessHandle,
    item: any,
): Promise<void> {
    if (item.content === undefined) {
        console.info('item content was empty');

        return;
    }

    const parsed = NodeHTMLParser.parse(item.content);

    // console.info(parsed);

    if (parsed.childNodes.length === 0) {
        console.info('no childNodes');

        return;
    }

    let imagePointer: Core.Models.Pointer.Pointer | undefined;
    let message = '';

    const textNodes = parsed.getElementsByTagName('p');

    if (textNodes.length > 0) {
        if (textNodes.length > 1) {
            console.info('more than one text node, using the first one');
        }

        const textNode = textNodes[0];

        if (textNode.childNodes.length !== 0) {
            message = textNode.childNodes[0].rawText;
            console.info('text is:', message);
        } else {
            console.info('text node had no children');
        }
    }

    const imageNodes = parsed.getElementsByTagName('img');

    if (imageNodes.length > 0) {
        if (imageNodes.length > 1) {
            console.info('more than one image node, using last one');
        }

        const imageNode = imageNodes[imageNodes.length - 1];

        const imgURL = imageNode.getAttribute('src');

        if (imgURL === undefined) {
            return;
        }

        console.info('imgURL is', imgURL);

        const imageResponse = await fetch(imgURL, {
            method: 'GET',
        });

        if (imageResponse.status !== 200) {
            console.warn('failed downloading image', imageResponse.status);
            return;
        }

        if (!imageResponse.headers.has('Content-Type')) {
            console.warn('media did not have content type header');
        }

        const mime = imageResponse.headers.get('Content-Type');

        if (
            mime === undefined ||
            (mime !== 'image/png' && mime !== 'image/jpeg')
        ) {
            console.warn('media unexpected mime', mime);
            return;
        }

        const imageRaw = new Uint8Array(await imageResponse.arrayBuffer());

        imagePointer = await processHandle.publishBlob(mime, imageRaw);
    }

    if (imagePointer === undefined && message === '') {
        return;
    }

    processHandle.post(message, imagePointer);
}

runBot(
    'state/ap',
    'ap.png',
    'The Associated Press',
    'Advancing the power of facts, globally.',
    'https://nitter.pw/ap/rss',
    handlerNitter,
);

runBot(
    'state/biden',
    'biden.jpeg',
    'President Biden',
    '46th President of the United States',
    'https://nitter.pw/potus/rss',
    handlerNitter,
);

runBot(
    'state/dril',
    'dril.jpeg',
    'wint',
    'Societary Fact Whisperer || alienPiss',
    'https://nitter.pw/dril/rss',
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
    'https://nitter.pw/archillect/rss',
    handlerNitter,
);
