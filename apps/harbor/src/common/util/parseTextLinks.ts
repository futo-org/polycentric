type SegmentBody =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; url: string }
  | { type: 'alias'; value: string; alias: string }
  | { type: 'identity'; value: string; identity: string }
  | { type: 'hashtag'; value: string; tag: string };

// `start`/`end` are raw offsets into the source text ([start, end)). Note
// `value` is the *rendered* text, which for curly mentions differs from the
// raw slice — use the offsets, not value lengths, to map back to the source.
export type TextSegment = SegmentBody & { start: number; end: number };

// Common TLDs accepted for bare (scheme-less, non-www) domains. Keeping
// this curated avoids turning things like "node.js" or "e.g." into links.
const TLD =
  '(?:com|org|net|edu|gov|mil|io|dev|app|co|me|gg|xyz|info|biz|tv|news|social|link|so|ai|sh|to|fm|fyi|page|site|blog|uk|us|ca|de|fr|nl|eu|es|it|jp|au|in|br|ru|ch|se|no|pl)';

// A dotted hostname whose final label is a known TLD.
const DOMAIN = `(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+${TLD}`;

// A polycentric identity: exactly 64 hex chars (a SHA-256 hash).
const HEX64 = /^[0-9a-fA-F]{64}$/;

// Matches, in order: curly mentions (`@{identity,displayName}` — braces so the
// display name may contain spaces), any other standalone `@…` run (classified
// as identity/alias or rejected in code below), hashtags (word chars only, so
// `#foo.bar` matches just `#foo`), http(s) URLs, `www.` domains, and bare
// domains that end in a known TLD (optionally followed by a path/query). The
// `@` alternatives come first so a mention is taken whole instead of the bare
// domain inside it.
const LINK_REGEX = new RegExp(
  [
    '@\\{[^}]+\\}',
    '@[^\\s]+',
    '#[\\p{L}\\p{N}_]+',
    'https?:\\/\\/[^\\s]+',
    'www\\.[^\\s]+',
    `${DOMAIN}(?:\\/[^\\s]*)?`,
  ].join('|'),
  'giu',
);

// Punctuation that commonly trails a URL in prose but isn't part of it.
const TRAILING_PUNCT = /[.,!?;:'")\]}]+$/;

// A char that glues an `@`/`#` to the preceding word — an email's local part
// (`a@b.com`, in any script), `foo#bar`, another `@` — disqualifying it as a
// mention or hashtag.
export const TOKEN_PRECEDER = /[\p{L}\p{N}_@]/u;

// A hashtag needs at least one non-digit, so prose like "we're #1" (and HTML
// entities like `&#39;`) stays plain text.
const DIGITS_ONLY = /^[0-9]+$/;

const HAS_SCHEME = /^https?:\/\//i;

/**
 * Splits `text` into plain-text, link, mention, and hashtag segments.
 *
 * A standalone `#` followed by word characters (at least one non-digit) is a
 * hashtag.
 *
 * A standalone `@` (not preceded by a word character, so an email's `@` never
 * starts one) begins a mention:
 * - `@{identity,displayName}` / `@{identity}` — identity mention rendered as
 *   the bare display name; identity must be 64 hex chars. The default form.
 * - `@<64-hex>` — identity mention.
 * - anything else containing a dot (`@user@domain.com`, `@domain.com`) — alias
 *   mention.
 * - otherwise it's left as plain text.
 *
 * Links are http(s) URLs, `www.` domains, and bare domains with a known TLD.
 * Trailing sentence punctuation is excluded.
 */
export function parseTextLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  LINK_REGEX.lastIndex = 0;
  for (
    let match = LINK_REGEX.exec(text);
    match !== null;
    match = LINK_REGEX.exec(text)
  ) {
    const start = match.index;
    let raw = match[0];
    const isToken = raw[0] === '@' || raw[0] === '#';

    // Mentions and hashtags must be standalone: skip an email's `@`
    // (`a@b.com`, which also keeps its domain part from being linkified — the
    // skip consumes the run) and `foo#bar`.
    if (isToken && start > 0 && TOKEN_PRECEDER.test(text[start - 1])) {
      continue;
    }

    // A curly mention ends at its `}`; don't strip that as punctuation.
    const isCurlyMention =
      raw[0] === '@' && raw[1] === '{' && raw.endsWith('}');

    if (!isCurlyMention) {
      const trail = raw.match(TRAILING_PUNCT)?.[0] ?? '';
      if (trail) raw = raw.slice(0, raw.length - trail.length);
      if (!raw) continue;
    }

    const segment = parseSegment(raw, isCurlyMention);
    if (!segment) continue;

    if (start > lastIndex) {
      segments.push({
        type: 'text',
        value: text.slice(lastIndex, start),
        start: lastIndex,
        end: start,
      });
    }

    segments.push({ ...segment, start, end: start + raw.length });

    // Resume scanning after the match, leaving any trailing punctuation
    // to be picked up as plain text.
    lastIndex = start + raw.length;
    LINK_REGEX.lastIndex = lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      value: text.slice(lastIndex),
      start: lastIndex,
      end: text.length,
    });
  }

  return segments;
}

function parseSegment(raw: string, isCurly: boolean): SegmentBody | null {
  if (isCurly) {
    const content = raw.slice(2, -1);
    const separatorIndex = content.indexOf(',');
    const identity = ~separatorIndex
      ? content.slice(0, separatorIndex)
      : content;

    if (!HEX64.test(identity)) return null;

    // With a display name, render it bare; `@` is only shown for the
    // identity/alias forms (and when the name is empty: `@{id,}`).
    const name = ~separatorIndex ? content.slice(separatorIndex + 1) : '';
    return { type: 'identity', value: name || `@${identity}`, identity };
  }

  if (raw[0] === '@') {
    const body = raw.slice(1);

    if (HEX64.test(body))
      return { type: 'identity', value: raw, identity: body };

    if (body.includes('.')) return { type: 'alias', value: raw, alias: body };

    return null;
  }

  if (raw[0] === '#') {
    const tag = raw.slice(1);
    return DIGITS_ONLY.test(tag) ? null : { type: 'hashtag', value: raw, tag };
  }

  return {
    type: 'link',
    value: raw,
    url: HAS_SCHEME.test(raw) ? raw : `https://${raw}`,
  };
}

/**
 * `text` as it reads once rendered: curly mentions become their display name,
 * everything else stays as typed. For plain-text surfaces that don't render
 * segments (previews, page titles) — slice this, not the raw text.
 */
export function mentionsToPlainText(text: string): string {
  return parseTextLinks(text)
    .map((s) => s.value)
    .join('');
}
