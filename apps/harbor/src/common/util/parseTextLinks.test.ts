import {
  mentionsToPlainText,
  parseTextLinks,
  type TextSegment,
} from './parseTextLinks';

/**
 * parseTextLinks minus the raw offsets, so the segment assertions below stay
 * compact. Offsets get their own describe block at the end.
 */
const parse = (text: string) =>
  parseTextLinks(text).map(
    ({ start: _start, end: _end, ...body }) => body,
  ) as TextSegment[];

/** Just the link segments. */
const links = (text: string) =>
  parse(text).filter(
    (s): s is Extract<TextSegment, { type: 'link' }> => s.type === 'link',
  );

/** Display values of the link segments. */
const linkValues = (text: string) => links(text).map((l) => l.value);

/** Resolved URLs of the link segments. */
const linkUrls = (text: string) => links(text).map((l) => l.url);

/** Just the alias segments. */
const aliases = (text: string) =>
  parse(text).filter(
    (s): s is Extract<TextSegment, { type: 'alias' }> => s.type === 'alias',
  );

/** Just the identity segments. */
const identities = (text: string) =>
  parse(text).filter(
    (s): s is Extract<TextSegment, { type: 'identity' }> =>
      s.type === 'identity',
  );

const HEX64 =
  '0a2abecb223dbd572729018f8d201f32471e2a5b71e2032c052f6830846c4722';

describe('parseTextLinks', () => {
  describe('no links', () => {
    it('returns a single text segment for plain text', () => {
      expect(parse('just some words')).toEqual([
        { type: 'text', value: 'just some words' },
      ]);
    });

    it('returns nothing for an empty string', () => {
      expect(parse('')).toEqual([]);
    });

    it('does not linkify "node.js" / "e.g." / "file.txt" (unknown TLDs)', () => {
      expect(linkValues('see index.js and file.txt, e.g. nothing')).toEqual([]);
    });

    it('does not linkify a domain with no TLD', () => {
      expect(linkValues('localhost and foo are not links')).toEqual([]);
    });
  });

  describe('http(s) URLs', () => {
    it('detects an http URL', () => {
      expect(links('go http://example.com now')).toEqual([
        {
          type: 'link',
          value: 'http://example.com',
          url: 'http://example.com',
        },
      ]);
    });

    it('detects an https URL', () => {
      expect(linkUrls('https://example.com')).toEqual(['https://example.com']);
    });

    it('keeps path, query, and fragment', () => {
      const url = 'https://example.com/a/b?x=1&y=2#frag';
      expect(linkUrls(url)).toEqual([url]);
    });

    it('keeps a port number', () => {
      expect(linkUrls('http://localhost:3000/x')).toEqual([
        'http://localhost:3000/x',
      ]);
    });

    it('handles an uppercase scheme', () => {
      expect(linkUrls('HTTPS://Example.com')).toEqual(['HTTPS://Example.com']);
    });
  });

  describe('www. and bare domains (scheme prepended)', () => {
    it('detects a www. domain and prepends https', () => {
      expect(links('visit www.example.com')).toEqual([
        {
          type: 'link',
          value: 'www.example.com',
          url: 'https://www.example.com',
        },
      ]);
    });

    it('detects a bare domain with a known TLD', () => {
      expect(links('go to example.com today')).toEqual([
        { type: 'link', value: 'example.com', url: 'https://example.com' },
      ]);
    });

    it('detects a bare domain with a path', () => {
      expect(links('example.org/path/to/page')).toEqual([
        {
          type: 'link',
          value: 'example.org/path/to/page',
          url: 'https://example.org/path/to/page',
        },
      ]);
    });

    it('detects subdomains', () => {
      expect(linkValues('sub.docs.example.io')).toEqual([
        'sub.docs.example.io',
      ]);
    });

    it('detects multi-part TLDs (example.co.uk)', () => {
      expect(linkValues('example.co.uk/about')).toEqual([
        'example.co.uk/about',
      ]);
    });
  });

  describe('trailing punctuation', () => {
    it.each([
      ['period', 'see example.com.', 'example.com', '.'],
      ['comma', 'see example.com, then', 'example.com', ','],
      ['exclamation', 'wow https://example.com!', 'https://example.com', '!'],
      ['question', 'is it example.com?', 'example.com', '?'],
      ['close paren', '(https://example.com)', 'https://example.com', ')'],
    ])('excludes a trailing %s from the link', (_label, input, value) => {
      expect(linkValues(input)).toEqual([value]);
    });

    it('leaves trailing punctuation in the text stream', () => {
      const segs = parse('see example.com.');
      expect(segs).toEqual([
        { type: 'text', value: 'see ' },
        { type: 'link', value: 'example.com', url: 'https://example.com' },
        { type: 'text', value: '.' },
      ]);
    });

    it('keeps a trailing slash (not punctuation)', () => {
      expect(linkValues('https://example.com/')).toEqual([
        'https://example.com/',
      ]);
    });
  });

  describe('emails', () => {
    it('does not linkify an email address', () => {
      expect(linkValues('reach me@example.com please')).toEqual([]);
    });

    it('does not linkify the domain inside an email', () => {
      expect(parse('a@b.com')).toEqual([{ type: 'text', value: 'a@b.com' }]);
    });
  });

  describe('alias mentions', () => {
    it('detects an `@user@domain.com` mention', () => {
      expect(parse('@user@domain.com')).toEqual([
        { type: 'alias', value: '@user@domain.com', alias: 'user@domain.com' },
      ]);
    });

    it('detects a mention within surrounding text', () => {
      expect(parse('hey @user@domain.com bye')).toEqual([
        { type: 'text', value: 'hey ' },
        { type: 'alias', value: '@user@domain.com', alias: 'user@domain.com' },
        { type: 'text', value: ' bye' },
      ]);
    });

    it('excludes trailing punctuation from the mention', () => {
      expect(parse('see @user@domain.com.')).toEqual([
        { type: 'text', value: 'see ' },
        { type: 'alias', value: '@user@domain.com', alias: 'user@domain.com' },
        { type: 'text', value: '.' },
      ]);
    });

    it('preserves case (normalisation happens downstream)', () => {
      expect(aliases('@User@Domain.com')).toEqual([
        { type: 'alias', value: '@User@Domain.com', alias: 'User@Domain.com' },
      ]);
    });

    it('allows dotted/underscored local parts', () => {
      expect(aliases('@first.last_1@domain.io')).toEqual([
        {
          type: 'alias',
          value: '@first.last_1@domain.io',
          alias: 'first.last_1@domain.io',
        },
      ]);
    });

    it('does not treat a plain email as a mention', () => {
      expect(aliases('reach me@example.com please')).toEqual([]);
    });

    it('does not treat a non-ASCII email as a mention', () => {
      expect(aliases('reach andré@example.com or 漢字@example.com')).toEqual(
        [],
      );
    });

    it('allows punctuation directly before a mention', () => {
      expect(aliases('(@user@domain.com)').map((a) => a.alias)).toEqual([
        'user@domain.com',
      ]);
    });

    it('does not match `@user@localhost` (no dot)', () => {
      expect(aliases('@user@localhost here')).toEqual([]);
    });

    it('detects a bare `@domain.com` mention', () => {
      expect(aliases('hi @domain.com')).toEqual([
        { type: 'alias', value: '@domain.com', alias: 'domain.com' },
      ]);
    });

    it('does not require a known TLD', () => {
      expect(aliases('@user@some.internal')).toEqual([
        {
          type: 'alias',
          value: '@user@some.internal',
          alias: 'user@some.internal',
        },
      ]);
    });

    it('leaves a dotless `@word` as plain text', () => {
      expect(parse('hey @everyone hi')).toEqual([
        { type: 'text', value: 'hey @everyone hi' },
      ]);
    });
  });

  describe('curly mentions', () => {
    it('detects `@{identity,displayName}` and renders the display name', () => {
      expect(parse(`hi @{${HEX64},Jane Doe} bye`)).toEqual([
        { type: 'text', value: 'hi ' },
        { type: 'identity', value: 'Jane Doe', identity: HEX64 },
        { type: 'text', value: ' bye' },
      ]);
    });

    it('detects `@{identity}` without a display name', () => {
      expect(parse(`@{${HEX64}}`)).toEqual([
        { type: 'identity', value: `@${HEX64}`, identity: HEX64 },
      ]);
    });

    it('falls back to the identity when the display name is empty', () => {
      expect(parse(`@{${HEX64},}`)).toEqual([
        { type: 'identity', value: `@${HEX64}`, identity: HEX64 },
      ]);
    });

    it('keeps trailing punctuation outside the braces as text', () => {
      expect(parse(`see @{${HEX64},Jane}.`)).toEqual([
        { type: 'text', value: 'see ' },
        { type: 'identity', value: 'Jane', identity: HEX64 },
        { type: 'text', value: '.' },
      ]);
    });

    it('rejects a non-hex identity', () => {
      expect(parse('@{notanidentity,Jane}')).toEqual([
        { type: 'text', value: '@{notanidentity,Jane}' },
      ]);
    });
  });

  describe('identity mentions', () => {
    it('detects an `@<64-hex>` mention', () => {
      expect(parse(`@${HEX64}`)).toEqual([
        { type: 'identity', value: `@${HEX64}`, identity: HEX64 },
      ]);
    });

    it('detects a mention within surrounding text', () => {
      expect(parse(`hi @${HEX64} ok`)).toEqual([
        { type: 'text', value: 'hi ' },
        { type: 'identity', value: `@${HEX64}`, identity: HEX64 },
        { type: 'text', value: ' ok' },
      ]);
    });

    it('excludes trailing punctuation from the mention', () => {
      expect(parse(`see @${HEX64}.`)).toEqual([
        { type: 'text', value: 'see ' },
        { type: 'identity', value: `@${HEX64}`, identity: HEX64 },
        { type: 'text', value: '.' },
      ]);
    });

    it('does not match fewer than 64 hex chars', () => {
      expect(identities('@deadbeef here')).toEqual([]);
    });

    it('does not match a longer hex run (not exactly 64)', () => {
      expect(identities(`@${HEX64}ab`)).toEqual([]);
    });

    it('does not match 64 non-hex chars', () => {
      expect(identities(`@${'g'.repeat(64)} here`)).toEqual([]);
    });
  });

  describe('hashtags', () => {
    it('detects a hashtag within surrounding text', () => {
      expect(parse('hey #some bye')).toEqual([
        { type: 'text', value: 'hey ' },
        { type: 'hashtag', value: '#some', tag: 'some' },
        { type: 'text', value: ' bye' },
      ]);
    });

    it('ends the hashtag at the first non-word character', () => {
      expect(parse('#foo.bar')).toEqual([
        { type: 'hashtag', value: '#foo', tag: 'foo' },
        { type: 'text', value: '.bar' },
      ]);
    });

    it('allows underscores and digits', () => {
      expect(parse('#foo_bar2')).toEqual([
        { type: 'hashtag', value: '#foo_bar2', tag: 'foo_bar2' },
      ]);
    });

    it('detects a unicode hashtag', () => {
      expect(parse('#日本語')).toEqual([
        { type: 'hashtag', value: '#日本語', tag: '日本語' },
      ]);
    });

    it('leaves an all-digit hashtag as plain text', () => {
      expect(parse("we're #1 fans")).toEqual([
        { type: 'text', value: "we're #1 fans" },
      ]);
    });

    it('requires the hashtag to be standalone', () => {
      expect(parse('foo#bar and &#39;')).toEqual([
        { type: 'text', value: 'foo#bar and &#39;' },
      ]);
    });

    it('does not break a URL fragment', () => {
      expect(parse('https://example.com/a#frag')).toEqual([
        {
          type: 'link',
          value: 'https://example.com/a#frag',
          url: 'https://example.com/a#frag',
        },
      ]);
    });
  });

  describe('multiple links & surrounding text', () => {
    it('detects several links with text between them', () => {
      const segs = parse('a https://x.com b www.y.org c example.net d');
      expect(segs).toEqual([
        { type: 'text', value: 'a ' },
        { type: 'link', value: 'https://x.com', url: 'https://x.com' },
        { type: 'text', value: ' b ' },
        { type: 'link', value: 'www.y.org', url: 'https://www.y.org' },
        { type: 'text', value: ' c ' },
        { type: 'link', value: 'example.net', url: 'https://example.net' },
        { type: 'text', value: ' d' },
      ]);
    });

    it('handles a link at the very start and end', () => {
      expect(parse('https://a.com')).toEqual([
        { type: 'link', value: 'https://a.com', url: 'https://a.com' },
      ]);
    });

    it('preserves newlines around links', () => {
      const segs = parse('line1\nhttps://example.com\nline2');
      expect(segs).toEqual([
        { type: 'text', value: 'line1\n' },
        {
          type: 'link',
          value: 'https://example.com',
          url: 'https://example.com',
        },
        { type: 'text', value: '\nline2' },
      ]);
    });
  });

  describe('losslessness', () => {
    it.each([
      'plain text only',
      'see https://example.com/path?x=1#y now',
      '(www.example.com), and example.org. done',
      'email a@b.com plus https://c.io end',
      'hey @user@domain.com and a@b.com and example.net',
      `mention @${HEX64} mid sentence`,
      'multi https://x.com www.y.org example.net z',
      'tags #some and #foo.bar, plus foo#bar and #1',
      '',
    ])('rejoining all segment values reproduces the input: %s', (input) => {
      const joined = parse(input)
        .map((s) => s.value)
        .join('');
      expect(joined).toBe(input);
    });
  });

  describe('raw offsets', () => {
    it('offsets stay raw after a curly mention (value ≠ raw slice)', () => {
      // The curly mention renders as "Jane" but occupies far more raw chars;
      // the alias after it must still report its true position.
      const input = `@{${HEX64},Jane} @user.example.com`;
      const alias = parseTextLinks(input).find((s) => s.type === 'alias');
      expect(alias).toBeDefined();
      expect(input.slice(alias!.start, alias!.end)).toBe('@user.example.com');
    });

    it('offsets tile the input with no gaps', () => {
      const input = `a @${HEX64} b #tag c`;
      let cursor = 0;
      for (const s of parseTextLinks(input)) {
        expect(s.start).toBe(cursor);
        cursor = s.end;
      }
      expect(cursor).toBe(input.length);
    });
  });
});

describe('mentionsToPlainText', () => {
  it('renders curly mentions as their display name and keeps the rest', () => {
    expect(
      mentionsToPlainText(`hi @{${HEX64},Jane Doe} see @{${HEX64}} @a.b.com`),
    ).toBe(`hi Jane Doe see @${HEX64} @a.b.com`);
  });

  it('is the identity for text without mentions', () => {
    expect(mentionsToPlainText('plain https://x.com #tag')).toBe(
      'plain https://x.com #tag',
    );
  });
});
