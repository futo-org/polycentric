import { View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  interpolate,
} from 'react-native-reanimated';
import { Atoms, withHexOpacity, useTheme } from '@/src/common/theme';

// Animated dots for carousel-like UIs
export function NavDots({
  count,
  offset,
  width,
}: {
  count: number;
  offset: SharedValue<number>;
  width: number;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        Atoms.p_sm,
        Atoms.rounded_lg,
        Atoms.flex_row,
        Atoms.gap_xs,
        { backgroundColor: withHexOpacity(theme.palette.black, 'b0') },
      ]}
    >
      {Array.from({ length: count }).map((_, index) => (
        <NavDot
          // biome-ignore lint/suspicious/noArrayIndexKey: dots are defined by their index
          key={index}
          index={index}
          offset={offset}
          width={width}
        />
      ))}
    </View>
  );
}

const INACTIVE_DOT_SCALE = 0.7;
const INACTIVE_DOT_OPACITY = 0.3;

function NavDot({
  index,
  offset,
  width,
}: {
  index: number;
  offset: SharedValue<number>;
  width: number;
}) {
  const { theme } = useTheme();
  const style = useAnimatedStyle(() => {
    const prev = (-index - 1) * width;
    const target = -index * width;
    const next = (-index + 1) * width;

    return {
      opacity: interpolate(
        offset.value,
        [prev, target, next],
        [INACTIVE_DOT_OPACITY, 1, INACTIVE_DOT_OPACITY],
        'clamp',
      ),
      transform: [
        {
          scale: interpolate(
            offset.value,
            [prev, target, next],
            [INACTIVE_DOT_SCALE, 1, INACTIVE_DOT_SCALE],
            'clamp',
          ),
        },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: theme.palette.white,
        },
        style,
      ]}
    ></Animated.View>
  );
}
