import { chunkOf, loadChunk } from '@/src/common/emoji/twemoji';
import { twemojiCode } from '@/src/common/util/emoji';
import { memo } from 'react';
import { type StyleProp, Text, View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

type Props = {
  sequence: string;
  size: number;
  style?: StyleProp<ViewStyle>;
};

/** A Twemoji SVG for one emoji; falls back to the platform glyph. */
export const EmojiImage = memo(function EmojiImage({
  sequence,
  size,
  style,
}: Props) {
  const code = twemojiCode(sequence);
  const xml = loadChunk(chunkOf(code))?.[code];
  if (!xml) return <Text style={{ fontSize: size * 0.85 }}>{sequence}</Text>;
  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center' }, style]}
      accessibilityLabel={sequence}
      testID="emoji"
    >
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
});
