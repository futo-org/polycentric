import { rewriteIdentityMentions } from './rewriteIdentityMentions';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const JANE = { [A]: 'Jane' };

describe('rewriteIdentityMentions', () => {
  it('rewrites a remembered identity mention to the curly form', () => {
    expect(rewriteIdentityMentions(`hi @${A} bye`, JANE)).toBe(
      `hi @{${A},Jane} bye`,
    );
  });

  it('leaves unremembered identities and deleted mentions alone', () => {
    expect(rewriteIdentityMentions(`hi @${B}`, JANE)).toBe(`hi @${B}`);
    expect(rewriteIdentityMentions('hi there', JANE)).toBe('hi there');
  });

  it('rewrites every occurrence and several identities', () => {
    expect(
      rewriteIdentityMentions(`@${A} @${B} @${A}`, { ...JANE, [B]: 'Joe' }),
    ).toBe(`@{${A},Jane} @{${B},Joe} @{${A},Jane}`);
  });

  it('handles start, end, newline and trailing punctuation like the parser', () => {
    expect(rewriteIdentityMentions(`@${A}\n@${A}.`, JANE)).toBe(
      `@{${A},Jane}\n@{${A},Jane}.`,
    );
  });

  it('leaves what the parser does not treat as a mention', () => {
    expect(rewriteIdentityMentions(`user@${A}`, JANE)).toBe(`user@${A}`);
    expect(rewriteIdentityMentions(`@${A}f`, JANE)).toBe(`@${A}f`);
    expect(rewriteIdentityMentions(`@{${A},Old}`, JANE)).toBe(`@{${A},Old}`);
  });

  // Tripwire: with a string replacement, `String.prototype.replace` reads
  // `$&`, `$1`, `$$` etc. as patterns, so a name like `$&` would become the
  // matched `@<hex>`. This fails if someone switches back to naive regex-based
  // replace logic
  it('does not treat $ in a name as a replacement pattern', () => {
    expect(rewriteIdentityMentions(`@${A}`, { [A]: '$&' })).toBe(`@{${A},$&}`);
  });
});
