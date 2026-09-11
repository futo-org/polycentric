import { TWEMOJI } from '@/src/common/emoji/twemoji';
import { twemojiCode } from '@/src/common/util/emoji';
import { memo } from 'react';
import { Image, type ImageStyle, type StyleProp, Text } from 'react-native';

type Props = {
  sequence: string;
  size: number;
  style?: StyleProp<ImageStyle>;
};

/** A Twemoji image for one emoji; falls back to the platform glyph. */
export const EmojiImage = memo(function EmojiImage({
  sequence,
  size,
  style,
}: Props) {
  const source = TWEMOJI[twemojiCode(sequence)];
  if (!source) return <Text style={{ fontSize: size * 0.85 }}>{sequence}</Text>;
  return (
    <Image
      source={source}
      resizeMode="contain"
      style={[{ width: size, height: size }, style]}
      accessibilityLabel={sequence}
      testID="emoji"
    />
  );
});
