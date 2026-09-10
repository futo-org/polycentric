import { UITextView } from '@bsky.app/react-native-uitextview';
import { Children, type ReactNode } from 'react';
import { type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { EmojiImage } from '@/src/common/components/EmojiImage';
import {
  useTheme,
  typography,
  type FontWeightToken,
  type PaletteColorToken,
  type FontSizeToken,
  type LineHeightToken,
} from '@/src/common/theme';
import { splitEmoji } from '@/src/common/util/emoji';
import { isWeb } from '@/src/common/util/platform';

const WEB_FONT_STACK =
  'NotoSans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Native font APIs can't select a variable font's weights, so each face is
// its own family (see `src/common/assets`). Keyed by every weight the theme
// can produce, so adding a token without a face fails to compile.
type FontWeightValue = (typeof typography.fontWeight)[FontWeightToken];
const NATIVE_FONTS: Record<
  FontWeightValue,
  { normal: string; italic: string }
> = {
  '400': { normal: 'NotoSans-Regular', italic: 'NotoSans-Italic' },
  '500': { normal: 'NotoSans-Medium', italic: 'NotoSans-MediumItalic' },
  '600': { normal: 'NotoSans-SemiBold', italic: 'NotoSans-SemiBoldItalic' },
  '700': { normal: 'NotoSans-Bold', italic: 'NotoSans-BoldItalic' },
};

// Inline Twemoji images, kept within the ascent (iOS clips above it) and
// nudged below the baseline like a platform emoji glyph.
const EMOJI_SIZE = 1.05;
const EMOJI_BASELINE_SHIFT = 0.12;
const EMOJI_GAP = 0.1;

function withEmojiImages(text: string, fontSize: number): ReactNode {
  const parts = splitEmoji(text);
  if (parts.length === 1) return text;
  const size = Math.round(fontSize * EMOJI_SIZE);
  const shift = Math.round(fontSize * EMOJI_BASELINE_SHIFT);
  const gap = Math.round(fontSize * EMOJI_GAP);
  return parts.map((part, i) =>
    i % 2 ? (
      <EmojiImage
        // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional, derived from the string
        key={i}
        sequence={part}
        size={size}
        style={[
          // iOS ignores margins on text attachments.
          isWeb
            ? { marginHorizontal: gap }
            : { width: size + 2 * gap, paddingHorizontal: gap },
          { transform: [{ translateY: shift }] },
        ]}
      />
    ) : (
      part
    ),
  );
}

function renderChildren(children: ReactNode, fontSize: number): ReactNode {
  if (typeof children === 'string') return withEmojiImages(children, fontSize);
  if (!Array.isArray(children)) return children;
  return Children.map(children, (child) =>
    typeof child === 'string' ? withEmojiImages(child, fontSize) : child,
  );
}

export type TextVariant = 'title' | 'subtitle' | 'body' | 'secondary' | 'small';

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: PaletteColorToken;
  fontWeight?: FontWeightToken;
  fontSize?: FontSizeToken | number;
  lineHeight?: LineHeightToken | number;
  italic?: boolean;
}

export function Text({
  variant = 'body',
  color,
  fontWeight,
  fontSize,
  lineHeight,
  italic,
  style,
  children,
  ...props
}: TextProps) {
  const { theme } = useTheme();

  const config = VARIANT_CONFIG[variant];
  const wantsItalic = italic && variant !== 'title' && variant !== 'subtitle';

  const resolvedFontSize = fontSize
    ? typeof fontSize === 'number'
      ? fontSize
      : typography.fontSize[fontSize]
    : typography.fontSize[config.size];

  const resolvedLineHeight = lineHeight
    ? typeof lineHeight === 'number'
      ? lineHeight
      : typography.lineHeight[lineHeight]
    : typography.lineHeight[config.size];

  const resolvedFontWeight = fontWeight
    ? typography.fontWeight[fontWeight]
    : typography.fontWeight[config.defaultWeight];

  const fontFamily = isWeb
    ? WEB_FONT_STACK
    : NATIVE_FONTS[resolvedFontWeight][wantsItalic ? 'italic' : 'normal'];

  return (
    <UITextView
      // iOS `selectable` Text only offers the copy callout; UITextView gives
      // real range selection. Everywhere else this renders the base Text.
      uiTextView={!!props.selectable}
      style={[
        {
          fontFamily,
          color: color ? theme.palette[color] : theme.palette.neutral_900,
          fontSize: resolvedFontSize,
          lineHeight: resolvedLineHeight,
          ...(isWeb
            ? {
                fontWeight: resolvedFontWeight,
                ...(wantsItalic ? { fontStyle: 'italic' as const } : {}),
              }
            : {}),
        },
        style,
      ]}
      {...props}
    >
      {renderChildren(
        children,
        StyleSheet.flatten(style)?.fontSize ?? resolvedFontSize,
      )}
    </UITextView>
  );
}

const VARIANT_CONFIG: Record<
  TextVariant,
  { size: FontSizeToken; defaultWeight: FontWeightToken }
> = {
  title: { size: 'lg', defaultWeight: 'bold' },
  subtitle: { size: 'lg', defaultWeight: 'semibold' },
  body: { size: 'md', defaultWeight: 'regular' },
  secondary: { size: 'md', defaultWeight: 'regular' },
  small: { size: 'xs', defaultWeight: 'semibold' },
} as const;
