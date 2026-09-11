import {
  mentionsToPlainText,
  parseTextLinks,
  truncateSegments,
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

describe('truncateSegments', () => {
  const truncate = (text: string, limit: number, atomic = true) =>
    truncateSegments(parseTextLinks(text), limit, { atomic });

  const rendered = (text: string, limit: number, atomic = true) =>
    truncate(text, limit, atomic)
      .segments.map((s) => s.value)
      .join('');

  describe('plain text', () => {
    it('cuts mid-way, with no word-boundary snapping', () => {
      expect(rendered('hello world', 5)).toBe('hello');
      expect(rendered('hello world', 8)).toBe('hello wo');
    });

    it('returns everything untouched when it fits', () => {
      const segments = parseTextLinks('hello world');
      expect(truncate('hello world', 11)).toEqual({
        segments,
        truncated: false,
      });
      expect(truncate('hello world', 100)).toEqual({
        segments,
        truncated: false,
      });
    });

    it('returns nothing for an empty input', () => {
      expect(truncate('', 10)).toEqual({ segments: [], truncated: false });
    });

    it('returns nothing, truncated, for a zero limit', () => {
      expect(truncate('hello', 0)).toEqual({ segments: [], truncated: true });
    });

    it('keeps raw offsets consistent on the cut segment', () => {
      const [cut] = truncate('abcdef', 3).segments;
      expect(cut).toEqual({ type: 'text', value: 'abc', start: 0, end: 3 });
    });

    it('keeps raw offsets consistent when the cut segment starts late', () => {
      const text = `@{${HEX64},Jo} abcdef`;
      const [, cut] = truncate(text, 5).segments;
      const start = text.indexOf(' ');
      expect(cut).toEqual({
        type: 'text',
        value: ' ab',
        start,
        end: start + 3,
      });
    });
  });

  describe('curly mentions', () => {
    it('counts by display name, not raw length', () => {
      const text = `hi @{${HEX64},Jane} bye`;
      expect(rendered(text, 6)).toBe('hi ');
      expect(rendered(text, 7)).toBe('hi Jane');
      expect(rendered(text, 8)).toBe('hi Jane ');
      expect(rendered(text, 100)).toBe('hi Jane bye');
    });

    it('counts a nameless curly mention by its rendered @identity', () => {
      const text = `@{${HEX64}} x`;
      expect(rendered(text, 64)).toBe('');
      expect(rendered(text, 65)).toBe(`@${HEX64}`);
    });

    it('is dropped whole when it does not fit', () => {
      expect(rendered(`hi @{${HEX64},Jane Doe} bye`, 6)).toBe('hi ');
      expect(rendered(`hi @{${HEX64},Jane Doe} bye`, 10)).toBe('hi ');
    });

    it('yields nothing when it is the first segment and wider than the limit', () => {
      expect(truncate(`@{${HEX64},Jane Doe} bye`, 3)).toEqual({
        segments: [],
        truncated: true,
      });
    });

    it('spends the budget across several mentions', () => {
      const text = `@{${HEX64},Al} @{${HEX64},Bo} @{${HEX64},Cy}`;
      expect(rendered(text, 5)).toBe('Al Bo');
      expect(rendered(text, 7)).toBe('Al Bo ');
      expect(rendered(text, 8)).toBe('Al Bo Cy');
    });
  });

  describe('other atomic segments', () => {
    it('drops a link that does not fit instead of splitting it', () => {
      expect(rendered('see https://example.com now', 10)).toBe('see ');
      expect(rendered('see https://example.com now', 23)).toBe(
        'see https://example.com',
      );
    });

    it('drops a hashtag that does not fit', () => {
      expect(rendered('go #hashtag now', 5)).toBe('go ');
      expect(rendered('go #hashtag now', 11)).toBe('go #hashtag');
    });

    it('drops an alias mention that does not fit', () => {
      expect(rendered('cc @user.example.com now', 10)).toBe('cc ');
      expect(rendered('cc @user.example.com now', 20)).toBe(
        'cc @user.example.com',
      );
    });

    it('drops a bare identity mention that does not fit', () => {
      expect(rendered(`cc @${HEX64} now`, 67)).toBe('cc ');
      expect(rendered(`cc @${HEX64} now`, 68)).toBe(`cc @${HEX64}`);
    });

    it('returns kept atomic segments by reference', () => {
      const segments = parseTextLinks('see https://example.com now');
      const kept = truncateSegments(segments, 23, { atomic: true }).segments;
      expect(kept[1]).toBe(segments[1]);
    });
  });

  describe('boundaries', () => {
    it('adds no empty text segment when the budget ends at a segment boundary', () => {
      const { segments } = truncate(`hi @{${HEX64},Jane} bye`, 7);
      expect(segments).toHaveLength(2);
      expect(segments.at(-1)?.type).toBe('identity');
    });

    it('reports truncated only when something was cut', () => {
      const text = `hi @{${HEX64},Jane}`;
      expect(truncate(text, 7).truncated).toBe(false);
      expect(truncate(text, 6).truncated).toBe(true);
      expect(truncate('hello', 5).truncated).toBe(false);
      expect(truncate('hello', 4).truncated).toBe(true);
    });

    it.each([true, false])(
      'is exactly "rendered length exceeds limit" (atomic: %s)',
      (atomic) => {
        const text = `a @{${HEX64},Jane} b https://x.com #t @u.example.com`;
        const renderedLength = mentionsToPlainText(text).length;
        for (const limit of [
          0,
          1,
          2,
          5,
          6,
          7,
          renderedLength - 1,
          renderedLength,
          renderedLength + 1,
        ]) {
          expect(truncate(text, limit, atomic).truncated).toBe(
            limit < renderedLength,
          );
        }
      },
    );

    it.each([true, false])(
      'kept segments tile a prefix of the raw text (atomic: %s)',
      (atomic) => {
        const text = `a @{${HEX64},Jane} b https://x.com #t @u.example.com end`;
        for (const limit of [0, 1, 3, 6, 7, 9, 20, 25, 40, 100]) {
          let cursor = 0;
          for (const s of truncate(text, limit, atomic).segments) {
            expect(s.start).toBe(cursor);
            cursor = s.end;
          }
        }
      },
    );
  });

  describe('non-atomic', () => {
    it('cuts the displayed text of a link but keeps its url', () => {
      const [, link] = truncate(
        'see https://example.com now',
        10,
        false,
      ).segments;
      expect(link).toEqual({
        type: 'link',
        value: 'https:',
        url: 'https://example.com',
        start: 4,
        end: 23,
      });
    });

    it('cuts a curly mention display name but keeps its identity', () => {
      const text = `hi @{${HEX64},Jane Doe} bye`;
      const [, mention] = truncate(text, 7, false).segments;
      expect(mention).toEqual({
        type: 'identity',
        value: 'Jane',
        identity: HEX64,
        start: 3,
        end: text.indexOf('}') + 1,
      });
    });

    it('cuts a hashtag and an alias but keeps their targets', () => {
      const [, tag] = truncate('go #hashtag now', 5, false).segments;
      expect(tag).toMatchObject({
        type: 'hashtag',
        value: '#h',
        tag: 'hashtag',
      });

      const [, alias] = truncate('cc @user.example.com now', 6, false).segments;
      expect(alias).toMatchObject({
        type: 'alias',
        value: '@us',
        alias: 'user.example.com',
      });
    });

    it('never renders past the limit', () => {
      const text = `a @{${HEX64},Jane} b https://x.com #t @u.example.com`;
      for (const limit of [0, 1, 3, 5, 9, 14, 20, 30, 100]) {
        expect(rendered(text, limit, false).length).toBeLessThanOrEqual(limit);
      }
    });

    it('stops at a segment boundary without adding an empty token', () => {
      const { segments } = truncate('go #hashtag now', 3, false);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({ type: 'text', value: 'go ' });
    });

    it('matches atomic mode whenever nothing is cut mid-token', () => {
      const text = `hi @{${HEX64},Jane} bye`;
      for (const limit of [0, 2, 3, 7, 8, 11, 100]) {
        expect(truncate(text, limit, false)).toEqual(truncate(text, limit));
      }
    });
  });
});
