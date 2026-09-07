/** Viewport box of the `@` being completed. */
export type MentionAnchor = { x: number; top: number; bottom: number };

/**
 * The `@` itself, or the start of the caret's line once the query has
 * wrapped below the `@`. Mirror-div trick: a hidden div styled like the
 * textarea wraps identically, so spans wrapping the same characters land
 * where they are. `caretIndex` is always past `atIndex`.
 */
export function measureWebMentionAnchor(
  node: HTMLTextAreaElement,
  atIndex: number,
  caretIndex: number,
): MentionAnchor {
  const mirror = document.createElement('div');
  const computed = getComputedStyle(node);
  for (const prop of MIRRORED_STYLES) {
    mirror.style.setProperty(prop, computed.getPropertyValue(prop));
  }
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '-9999px',
    height: 'auto',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
  });
  // Full text so words wrap exactly as in the textarea; the caret marker is
  // zero-width at the end so it doesn't affect wrapping.
  const { value } = node;
  const atMark = document.createElement('span');
  atMark.textContent = value[atIndex];
  const caretMark = document.createElement('span');
  caretMark.textContent = value[caretIndex] ?? '\u200b';
  mirror.append(
    value.slice(0, atIndex),
    atMark,
    value.slice(atIndex + 1, caretIndex),
    caretMark,
    value.slice(caretIndex + 1),
  );
  document.body.appendChild(mirror);

  const rect = node.getBoundingClientRect();
  const wrapped = caretMark.offsetTop > atMark.offsetTop;
  const mark = wrapped ? caretMark : atMark;
  const top = rect.top + mark.offsetTop - node.scrollTop;
  const anchor = {
    x: wrapped
      ? rect.left + parseFloat(computed.paddingLeft)
      : rect.left + mark.offsetLeft - node.scrollLeft,
    top,
    bottom: top + mark.offsetHeight,
  };
  mirror.remove();
  return anchor;
}

/** Everything that affects how text wraps and where it sits. */
const MIRRORED_STYLES = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'font-feature-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  'text-transform',
  'tab-size',
  'word-break',
  'overflow-wrap',
  'direction',
];
