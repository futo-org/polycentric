import { splitEmoji, twemojiCode } from './emoji';

describe('splitEmoji', () => {
  it('returns plain text untouched', () => {
    expect(splitEmoji('hello world')).toEqual(['hello world']);
    expect(splitEmoji('')).toEqual(['']);
  });

  it('interleaves text and emoji runs', () => {
    expect(splitEmoji('hi 👋 there 🐈')).toEqual([
      'hi ',
      '👋',
      ' there ',
      '🐈',
      '',
    ]);
    expect(splitEmoji('🐈 first')).toEqual(['', '🐈', ' first']);
  });

  it('separates adjacent emoji', () => {
    expect(splitEmoji('❤️😂🤣')).toEqual(['', '❤️', '', '😂', '', '🤣', '']);
  });

  it('keeps sequences whole', () => {
    // ZWJ family, skin tone, flag, subdivision flag, keycap
    for (const emoji of ['👨‍👩‍👧', '👍🏽', '🇬🇧', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '1️⃣', '#⃣', '🏳️‍🌈']) {
      expect(splitEmoji(`a${emoji}b`)).toEqual(['a', emoji, 'b']);
    }
  });

  it('leaves typographic symbols and digits to the text font', () => {
    for (const text of [
      '1 + 1 = 2',
      'a → b',
      'a ↔ b',
      '© 2026 ™',
      'I ♥ NY',
      'done ✔',
      '▶ Play',
    ]) {
      expect(splitEmoji(text)).toEqual([text]);
    }
  });

  it('treats older pictographs as emoji even without U+FE0F', () => {
    for (const emoji of ['☹', '☺', '☀', '❤', '✈', '⚠']) {
      expect(splitEmoji(`a${emoji}b`)).toEqual(['a', emoji, 'b']);
    }
  });

  it('renders text-presentation symbols as emoji when asked with U+FE0F', () => {
    expect(splitEmoji('a ➡️ b')).toEqual(['a ', '➡️', ' b']);
    expect(splitEmoji('©️')).toEqual(['', '©️', '']);
  });
});

describe('twemojiCode', () => {
  it('matches Twemoji file names', () => {
    expect(twemojiCode('😀')).toBe('1f600');
    expect(twemojiCode('❤️')).toBe('2764');
    expect(twemojiCode('👍🏽')).toBe('1f44d-1f3fd');
    expect(twemojiCode('🇬🇧')).toBe('1f1ec-1f1e7');
    expect(twemojiCode('1️⃣')).toBe('31-20e3');
    expect(twemojiCode('🏳️‍🌈')).toBe('1f3f3-fe0f-200d-1f308');
  });
});
