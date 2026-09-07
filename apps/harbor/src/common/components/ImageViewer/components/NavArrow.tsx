import Icon from '@/src/common/components/Icon';
import { Atoms } from '@/src/common/theme';
import { Pressable } from 'react-native';

export function NavArrow({
  side,
  onPress,
  bg,
}: {
  side: 'left' | 'right';
  onPress: () => void;
  bg: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityLabel={side === 'left' ? 'Previous image' : 'Next image'}
      style={[
        Atoms.absolute,
        Atoms.items_center,
        Atoms.justify_center,
        Atoms.rounded_full,
        {
          top: '50%',
          width: 44,
          height: 44,
          transform: [{ translateY: -22 }],
          backgroundColor: bg,
        },
        side === 'left' ? { left: 16 } : { right: 16 },
      ]}
    >
      <Icon
        name={side === 'left' ? 'chevronBack' : 'chevronForward'}
        size={28}
        color="white"
      />
    </Pressable>
  );
}
