import {
  SHEET_CELL,
  SHEET_COLUMNS,
  SHEET_FILE,
  SHEET_INDEX,
} from '@/src/common/emoji/twemoji/sheet';
import { TWEMOJI_URL, twemojiCode } from '@/src/common/util/emoji';
import {
  type CSSProperties,
  memo,
  useState,
  useSyncExternalStore,
} from 'react';
import { type ImageStyle, type StyleProp, StyleSheet } from 'react-native';

type Props = {
  sequence: string;
  size: number;
  style?: StyleProp<ImageStyle>;
};

// The callers' React Native styles (margins, translateY) as CSS.
function toCss(style: StyleProp<ImageStyle>): CSSProperties {
  const { marginHorizontal, marginVertical, transform, ...rest } =
    StyleSheet.flatten(style) ?? {};
  const css: Record<string, unknown> = { ...rest };
  if (marginHorizontal !== undefined) {
    css.marginLeft = marginHorizontal;
    css.marginRight = marginHorizontal;
  }
  if (marginVertical !== undefined) {
    css.marginTop = marginVertical;
    css.marginBottom = marginVertical;
  }
  if (Array.isArray(transform)) {
    css.transform = transform
      .flatMap((t) => Object.entries(t))
      .map(([fn, v]) => `${fn}(${typeof v === 'number' ? `${v}px` : v})`)
      .join(' ');
  }
  return css as CSSProperties;
}

// The picker's emoji come from one sprite sheet, fetched once on the first
// emoji rendered; every cell then just points at its own region of it.
const SHEET_URL = `${TWEMOJI_URL}${SHEET_FILE}`;
let sheetReady = false;
let sheetImage: HTMLImageElement | undefined;
const sheetListeners = new Set<() => void>();
function subscribeSheet(listener: () => void) {
  sheetListeners.add(listener);
  if (!sheetImage) {
    sheetImage = new Image();
    sheetImage.onload = () => {
      sheetReady = true;
      for (const l of sheetListeners) l();
    };
    sheetImage.src = SHEET_URL;
  }
  return () => {
    sheetListeners.delete(listener);
  };
}
const useSheetReady = () =>
  useSyncExternalStore(subscribeSheet, () => sheetReady);

function Glyph({ sequence, size }: { sequence: string; size: number }) {
  return (
    <span
      data-testid="emoji"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.85,
        lineHeight: 1,
      }}
    >
      {sequence}
    </span>
  );
}

/**
 * A Twemoji image for one emoji: a region of the sprite sheet, or for
 * emoji outside it (skin tones, newer additions) its own PNG from
 * `public/twemoji/`. The platform glyph shows until the image is there,
 * and stays if there is none, so a scrolling grid is never blank.
 */
export const EmojiImage = memo(function EmojiImage({
  sequence,
  size,
  style,
}: Props) {
  const code = twemojiCode(sequence);
  const cell = SHEET_INDEX[code];
  const ready = useSheetReady();
  const src = `${TWEMOJI_URL}${code}.png`;
  // Keyed by src: a recycled list cell gets a new sequence on the same instance.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const showImage = cell === undefined ? loaded === src : ready;
  const scale = size / SHEET_CELL;
  return (
    <span
      role="img"
      aria-label={sequence}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: size,
        height: size,
        verticalAlign: 'middle',
        ...toCss(style),
      }}
    >
      {!showImage && <Glyph sequence={sequence} size={size} />}
      {cell !== undefined
        ? showImage && (
            <span
              data-testid="emoji"
              style={{
                display: 'block',
                width: size,
                height: size,
                backgroundImage: `url(${SHEET_URL})`,
                backgroundSize: `${SHEET_COLUMNS * SHEET_CELL * scale}px auto`,
                backgroundPosition: `${-(cell % SHEET_COLUMNS) * size}px ${-Math.floor(cell / SHEET_COLUMNS) * size}px`,
              }}
            />
          )
        : missing !== src && (
            <img
              src={src}
              width={size}
              height={size}
              decoding="async"
              draggable={false}
              alt=""
              data-testid="emoji"
              style={{
                display: 'block',
                width: size,
                height: size,
                objectFit: 'contain',
                opacity: showImage ? 1 : 0,
              }}
              onLoad={() => setLoaded(src)}
              onError={() => setMissing(src)}
            />
          )}
    </span>
  );
});
