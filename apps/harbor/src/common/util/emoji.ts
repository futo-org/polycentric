// Finds emoji in text for `components/EmojiImage`. A scanner, not a regex:
// JavaScriptCore mismatches mixed BMP/astral classes under the `u` flag.

type Range = number | readonly [number, number];

// Emoji on their own, including older pictographs often sent without U+FE0F.
// biome-ignore format: codepoint table
const EMOJI: readonly Range[] = [
  [0x231a, 0x231b], 0x2328, 0x23cf, [0x23e9, 0x23f3], [0x23f8, 0x23fa],
  [0x25fd, 0x25fe], [0x2600, 0x2604], 0x260e, [0x2614, 0x2615], 0x2618, 0x261d,
  0x2620, [0x2622, 0x2623], 0x2626, 0x262a, [0x262e, 0x262f], [0x2638, 0x263a],
  [0x2648, 0x2653], 0x2668, [0x267b, 0x267f], [0x2692, 0x2697], 0x2699,
  [0x269b, 0x269c], [0x26a0, 0x26a1], [0x26aa, 0x26ab], [0x26b0, 0x26b1],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], 0x26c8, [0x26ce, 0x26cf], 0x26d1,
  [0x26d3, 0x26d4], [0x26e9, 0x26ea], [0x26f0, 0x26f5], [0x26f7, 0x26fa], 0x26fd,
  0x2702, 0x2705, [0x2708, 0x270d], 0x270f, 0x2712, 0x271d, 0x2721, 0x2728,
  0x2744, 0x274c, 0x274e, [0x2753, 0x2755], 0x2757, [0x2763, 0x2764],
  [0x2795, 0x2797], 0x27b0, 0x27bf, [0x2b1b, 0x2b1c], 0x2b50, 0x2b55, 0x3297,
  0x3299,
  0x1f004, 0x1f0cf, [0x1f10d, 0x1f10f], 0x1f12f, [0x1f16d, 0x1f171],
  [0x1f17e, 0x1f17f], 0x1f18e, [0x1f191, 0x1f19a], [0x1f1e6, 0x1f1ff],
  [0x1f201, 0x1f202], 0x1f21a, 0x1f22f, [0x1f232, 0x1f23a], [0x1f250, 0x1f251],
  [0x1f260, 0x1f265], [0x1f300, 0x1f321], [0x1f324, 0x1f393], [0x1f396, 0x1f397],
  [0x1f399, 0x1f39b], [0x1f39e, 0x1f3f0], [0x1f3f3, 0x1f3f5], [0x1f3f7, 0x1f4fd],
  [0x1f4ff, 0x1f53d], [0x1f549, 0x1f54e], [0x1f550, 0x1f567], [0x1f56f, 0x1f570],
  [0x1f573, 0x1f57a], 0x1f587, [0x1f58a, 0x1f58d], 0x1f590, [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a5], 0x1f5a8, [0x1f5b1, 0x1f5b2], 0x1f5bc, [0x1f5c2, 0x1f5c4],
  [0x1f5d1, 0x1f5d3], [0x1f5dc, 0x1f5de], 0x1f5e1, 0x1f5e3, 0x1f5e8, 0x1f5ef,
  0x1f5f3, [0x1f5fa, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f6cb, 0x1f6d2],
  [0x1f6d5, 0x1f6d8], [0x1f6dc, 0x1f6e5], 0x1f6e9, [0x1f6eb, 0x1f6ec], 0x1f6f0,
  [0x1f6f3, 0x1f6fc], [0x1f7e0, 0x1f7eb], 0x1f7f0, [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff], [0x1fa70, 0x1fa7c], [0x1fa80, 0x1fa8a],
  [0x1fa8e, 0x1fac6], 0x1fac8, [0x1facd, 0x1fadc], [0x1fadf, 0x1faea],
  [0x1faef, 0x1faf8], [0x1fbc5, 0x1fbc9],
];

// Typographic symbols (©, arrows, ✔, ♥ ...): emoji only with U+FE0F.
// biome-ignore format: codepoint table
const TEXT_DEFAULT: readonly Range[] = [
  0xa9, 0xae, 0x203c, 0x2049, 0x2117, 0x2120, 0x2122, 0x2139, [0x2194, 0x2199],
  [0x21a9, 0x21aa], 0x229c, 0x24c2, 0x25a1, [0x25aa, 0x25ae], 0x25b6, 0x25c0,
  0x25c9, [0x25d0, 0x25d1], [0x25e7, 0x25ea], [0x25ed, 0x25ee], [0x25fb, 0x25fc],
  0x2605, 0x2611, 0x2640, 0x2642, [0x265f, 0x2660], 0x2663, [0x2665, 0x2666],
  0x26a7, 0x2714, 0x2716, [0x2733, 0x2734], 0x2747, 0x27a1, [0x2934, 0x2935],
  [0x2b05, 0x2b07], [0x2b0c, 0x2b0d], [0x2b1f, 0x2b24], [0x2b2e, 0x2b2f], 0x2b58,
  0x2b8f, [0x2bba, 0x2bbc], [0x2bc3, 0x2bc4], [0x2bea, 0x2beb], 0x3030, 0x303d,
];

type Span = readonly [number, number];

const spans = (list: readonly Range[]): Span[] =>
  list
    .map((r): Span => (typeof r === 'number' ? [r, r] : r))
    .sort((x, y) => x[0] - y[0]);

const EMOJI_SPANS = spans(EMOJI);
const TEXT_DEFAULT_SPANS = spans(TEXT_DEFAULT);

function inSpans(cp: number, list: Span[]): boolean {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = list[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

const ZWJ = 0x200d;
const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;
const isKeycapBase = (cp: number) =>
  cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39);
// Skin tone modifiers and tag characters (subdivision flags).
const isModifier = (cp: number) =>
  (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f);
const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const width = (cp: number) => (cp > 0xffff ? 2 : 1);

/** End of the emoji element starting at `i`, or -1 if there is none. */
function elementEnd(text: string, i: number): number {
  const cp = text.codePointAt(i) as number;
  let j = i + width(cp);
  if (isKeycapBase(cp)) {
    if (text.charCodeAt(j) === VS16) j++;
    return text.charCodeAt(j) === KEYCAP ? j + 1 : -1;
  }
  if (isRegionalIndicator(cp)) {
    // Flags are pairs.
    const next = text.codePointAt(j);
    return next !== undefined && isRegionalIndicator(next) ? j + 2 : j;
  }
  if (inSpans(cp, EMOJI_SPANS)) {
    return text.charCodeAt(j) === VS16 ? j + 1 : j;
  }
  if (inSpans(cp, TEXT_DEFAULT_SPANS) && text.charCodeAt(j) === VS16) {
    return j + 1;
  }
  return -1;
}

/** End of the emoji sequence (element, modifiers, ZWJ joins) at `i`, or -1. */
function sequenceEnd(text: string, i: number): number {
  let j = elementEnd(text, i);
  if (j < 0) return -1;
  for (;;) {
    while (j < text.length && isModifier(text.codePointAt(j) as number)) {
      j += width(text.codePointAt(j) as number);
    }
    if (text.charCodeAt(j) !== ZWJ) return j;
    const next = elementEnd(text, j + 1);
    if (next < 0) return j;
    j = next;
  }
}

/**
 * Splits text into alternating runs, starting with text: even indices are
 * plain text, odd indices are single emoji sequences. A string with no emoji
 * comes back as a single element.
 */
export function splitEmoji(text: string): string[] {
  const parts: string[] = [];
  let textStart = 0;
  let i = 0;
  while (i < text.length) {
    const end = sequenceEnd(text, i);
    if (end < 0) {
      i += width(text.codePointAt(i) as number);
      continue;
    }
    parts.push(text.slice(textStart, i), text.slice(i, end));
    textStart = end;
    i = end;
  }
  parts.push(text.slice(textStart));
  return parts;
}

// Where `public/twemoji/` is served. A separate export so the bundle keeps
// the literal, which the web deploy rewrites to the static bucket.
export const TWEMOJI_URL = '/twemoji/';

/**
 * Twemoji's file name for a sequence: code points in hex joined by "-", with
 * U+FE0F dropped unless the sequence has a ZWJ (matching twemoji.js).
 */
export function twemojiCode(sequence: string): string {
  const cps = [...sequence].map((ch) => ch.codePointAt(0) as number);
  const keepVs16 = cps.includes(ZWJ);
  return cps
    .filter((cp) => keepVs16 || cp !== VS16)
    .map((cp) => cp.toString(16))
    .join('-');
}
