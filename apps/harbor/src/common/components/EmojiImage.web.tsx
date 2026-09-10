import { twemojiCode } from '@/src/common/util/emoji';
import { memo, useState } from 'react';
import { Image, type ImageStyle, type StyleProp, Text } from 'react-native';

type Props = {
  sequence: string;
  size: number;
  style?: StyleProp<ImageStyle>;
};

/** A Twemoji SVG from `public/twemoji/`; falls back to the platform glyph. */
export const EmojiImage = memo(function EmojiImage({
  sequence,
  size,
  style,
}: Props) {
  const [missing, setMissing] = useState(false);
  if (missing) return <Text style={{ fontSize: size * 0.85 }}>{sequence}</Text>;
  return (
    <Image
      source={{ uri: `/twemoji/${twemojiCode(sequence)}.svg` }}
      style={[{ width: size, height: size }, style]}
      accessibilityLabel={sequence}
      onError={() => setMissing(true)}
      testID="emoji"
    />
  );
});
