import {
  mentionsToPlainText,
  parseTextLinks,
  type TextSegment,
} from './parseTextLinks';
import mentionFixtures from '../../../../../packages/rs-common/src/mentions.fixtures.json';

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

  // Cases shared with the server's `mentions.rs` (see the note at the top of
  // parseTextLinks.ts), so both parsers agree on every mention form.
  describe('mentions', () => {
    it.each(mentionFixtures)('$name', ({ text, mentions, plain }) => {
      type Found = { identity: string } | { alias: string };
      const found = parse(text).flatMap((s): Found[] =>
        s.type === 'identity'
          ? [{ identity: s.identity }]
          : s.type === 'alias'
            ? [{ alias: s.alias }]
            : [],
      );
      expect(found).toEqual(mentions);
      expect(mentionsToPlainText(text)).toBe(plain);
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
