import * as AbstractLevel from 'abstract-level';
import * as ClassicLevel from 'classic-level';
import Parser from 'rss-parser';
import fetch from 'node-fetch';
import * as FS from 'fs';
import * as XML2JS from 'xml2js';

import * as Core from 'polycentric-core';

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
    const level = new ClassicLevel.ClassicLevel<Uint8Array, Uint8Array>(
        stateDirectoryPath + '/polycentric',
        {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        },
    ) as any as AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>;

    const levelRSS = new ClassicLevel.ClassicLevel<string, string>(
        stateDirectoryPath + '/rss',
        {
            keyEncoding: 'utf8',
            valueEncoding: 'utf8',
        },
    );

    const state = new Core.DB.PolycentricState(level);

    if (!(await Core.DB.doesIdentityExist(state))) {
        console.log('generating new identity');

        await Core.DB.newIdentity(state);
    }

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

    await Core.DB.startIdentity(state);

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

            for (const item of feed.items) {
                if (item.guid === undefined) {
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
        return;
    }

    const lines = item.content.split('\n');

    if (lines.length !== 2) {
        return;
    }

    const parsed = await XML2JS.parseStringPromise(lines[1], { strict: false });

    const imgURL = parsed['IMG']['$']['SRC'];
    const imageKind = imgURL.substr(imgURL.length - 3);

    if (imageKind !== 'png' && imageKind !== 'jpg') {
        console.log('unknown image type', imageKind);
        return;
    }

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

    if (mime !== 'image/png' && mime !== 'image/jpeg') {
        console.log('media unexpected mime', mime);
        return;
    }

    const imageRaw = new Uint8Array(await imageResponse.arrayBuffer());

    const event = Core.DB.makeDefaultEventBody();
    event.message = {
        message: new TextEncoder().encode(''),
        boostPointer: undefined,
    };

    event.message.image = await Core.DB.saveBlob(state, mime, imageRaw);

    await Core.DB.levelSavePost(state, event);
}

runBot(
    'state_hackernews',
    'hnlogo.jpg',
    'Hacker News Bot',
    'Posting content from the front page of Hacker News',
    'https://hnrss.org/frontpage',
    handlerHackerNews,
);

runBot(
    'state_archillect',
    'archillectlogo.jpg',
    'Archillect',
    'The ocular engine.',
    'https://nitter.net/archillect/rss',
    handlerNitter,
);
