import { EmojiImage } from '@/src/common/components/EmojiImage';
import { Text } from '@/src/common/components/primitives/Text';
import Icon, { type IconName } from '@/src/common/components/Icon';
import { withIdentity } from '@/src/common/lib/authGate';
import {
  Atoms,
  type PaletteColorToken,
  useTheme,
  withHexOpacity,
} from '@/src/common/theme';
import { useCallback } from 'react';
import {
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  View,
} from 'react-native';

type PostActionButtonProps = {
  icon: IconName;
  /** Rendered in place of the icon. */
  emoji?: string;
  count?: number;
  active?: boolean;
  highlighted?: boolean;
  color?: PaletteColorToken;
  size?: number | undefined;
} & Omit<PressableProps, 'style' | 'children'>;

export default function PostActionButton({
  icon,
  emoji,
  count,
  active = false,
  highlighted = false,
  color = 'neutral_500',
  size = 18,
  onPress,
  ...props
}: PostActionButtonProps) {
  const { theme } = useTheme();

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      withIdentity(() => onPress?.(event));
    },
    [onPress],
  );

  return (
    <View style={[Atoms.flex_row, Atoms.justify_start]}>
      <Pressable
        {...props}
        onPress={handlePress}
        style={[Atoms.flex_row, Atoms.outline_none, Atoms.items_center]}
        hitSlop={8}
      >
        {({ pressed, hovered }) => {
          const isHighlighted = hovered || pressed || highlighted;
          return (
            <View
              style={[
                Atoms.flex_row,
                Atoms.align_center,
                Atoms.justify_center,
                Atoms.gap_sm,
                Atoms.px_md,
                Atoms.py_sm,
                Atoms.rounded_full,
                // overflow:hidden forces a rounded clip on native
                Atoms.overflow_hidden,
                {
                  backgroundColor: isHighlighted
                    ? withHexOpacity(theme.palette[color], '14')
                    : 'transparent',
                },
              ]}
            >
              {emoji ? (
                <EmojiImage sequence={emoji} size={size} />
              ) : (
                <Icon
                  name={icon}
                  size={size}
                  color={active || highlighted ? color : 'neutral_500'}
                />
              )}
              {count ? (
                <Text
                  variant="small"
                  fontSize="sm"
                  color={active || highlighted ? color : 'neutral_500'}
                >
                  {String(count)}
                </Text>
              ) : null}
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
