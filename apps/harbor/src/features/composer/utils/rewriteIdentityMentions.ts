import { parseTextLinks } from '@/src/common/util/parseTextLinks';

// Rewrite identity mentions in text with @{identity,name} mentions from a remembered map
export function rewriteIdentityMentions(
  text: string,
  mentions: Record<string, string>,
): string {
  // Splice from the end so earlier offsets stay valid.
  for (const s of parseTextLinks(text).reverse()) {
    if (s.type !== 'identity' || text[s.start + 1] === '{') continue;
    const name = mentions[s.identity];
    if (!name) continue;
    text = `${text.slice(0, s.start)}@{${s.identity},${name}}${text.slice(s.end)}`;
  }
  return text;
}
