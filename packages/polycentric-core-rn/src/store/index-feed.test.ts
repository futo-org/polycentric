import Long from 'long';

import * as ProcessHandle from '../process-handle';
import * as Store from '.';
import * as Models from '../models';
import * as Protocol from '../protocol';

function extractPostBodyAsText(
  signedEvent: Models.SignedEvent.SignedEvent,
): string {
  const event = Models.Event.fromBuffer(signedEvent.event);

  if (!event.contentType.equals(Models.ContentType.ContentTypePost)) {
    throw Error('expected content type post');
  }

  const post = Protocol.Post.decode(event.content);

  if (post.content === undefined) {
    throw Error('expected post content');
  }

  return post.content;
}

describe('IndexFeed', () => {
  test('extractSystemFromCursor', async () => {
    const privateKey = Models.PrivateKey.random();
    const publicKey = await Models.PrivateKey.derivePublicKey(privateKey);
    const process = Models.Process.random();

    const cursor = Store.IndexFeed.makeKey(
      publicKey,
      process,
      Long.fromNumber(52, true),
      Long.fromNumber(10, true),
    );

    const extracted = Store.IndexFeed.extractSystemFromCursor(cursor);

    expect(Models.PublicKey.equal(extracted, publicKey)).toStrictEqual(true);
  });

  test('extractEventKeyFromCursor', async () => {
    const privateKey = Models.PrivateKey.random();
    const publicKey = await Models.PrivateKey.derivePublicKey(privateKey);
    const process = Models.Process.random();

    const cursor = Store.IndexFeed.makeKey(
      publicKey,
      process,
      Long.fromNumber(52, true),
      Long.fromNumber(10, true),
    );

    const extracted = Store.IndexFeed.extractEventKeyFromCursor(cursor);

    const expected = Store.IndexEvents.makeEventKey(
      publicKey,
      process,
      Long.fromNumber(52, true),
    );

    expect(extracted).toStrictEqual(expected);
  });

  test('query', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();

    for (let i = 0; i < 20; i++) {
      await s1p1.post(i.toString());
    }

    const query1 = await s1p1.store().indexFeed.query(15, undefined);
    expect(query1.items).toStrictEqual([]);
    expect(query1.cursor).toBeDefined();

    await s1p1.follow(s1p1.system());

    const query2 = await s1p1.store().indexFeed.query(2, undefined);

    expect(query2.items.map(extractPostBodyAsText)).toStrictEqual(['19', '18']);

    const query3 = await s1p1.store().indexFeed.query(30, query2.cursor);

    const query3Expected = [];

    for (let i = 17; i >= 0; i--) {
      query3Expected.push(i.toString());
    }

    expect(query3.items.map(extractPostBodyAsText)).toStrictEqual(
      query3Expected,
    );

    expect(query3.cursor).toBeUndefined();
  });
});
