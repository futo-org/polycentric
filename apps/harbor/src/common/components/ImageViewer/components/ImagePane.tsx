import { Image } from '@/src/common/components/Image';
import { Atoms } from '@/src/common/theme';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { PANE_HEIGHT } from '../constants';
import type { ResolvedImageSource } from '../resolveImageSources';

export function ImagePane({
  source,
  paneX,
  isCurrent,
  offsetX,
  scale,
  translateX,
  translateY,
  dismissY,
}: {
  source: ResolvedImageSource;
  /** This pane's resting X within the strip (index × screen width). */
  paneX: number;
  isCurrent: boolean;
  offsetX: SharedValue<number>;
  scale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  dismissY: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const stripX = offsetX.value + paneX;
    return {
      transform: isCurrent
        ? [
            { translateX: stripX + translateX.value },
            { translateY: translateY.value + dismissY.value },
            { scale: scale.value },
          ]
        : [{ translateX: stripX }],
    };
  });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        Atoms.items_center,
        Atoms.justify_center,
        style,
      ]}
    >
      <View
        style={[
          Atoms.items_center,
          Atoms.justify_center,
          { width: '100%', height: `${PANE_HEIGHT * 100}%` },
        ]}
      >
        <View
          style={[
            Atoms.w_full,
            { aspectRatio: source.aspectRatio ?? 1, maxHeight: '100%' },
          ]}
        >
          <Image
            uris={source.uris}
            contentFit="contain"
            priority={isCurrent ? 'high' : 'low'}
            style={[Atoms.w_full, Atoms.h_full]}
          />
        </View>
      </View>
    </Animated.View>
  );
}
