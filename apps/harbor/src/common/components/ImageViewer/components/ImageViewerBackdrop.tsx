import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { PINCH_CLOSE_SCALE } from '../constants';

export function ImageViewerBackdrop({
  scale,
  dismissY,
}: {
  scale: SharedValue<number>;
  dismissY: SharedValue<number>;
}) {
  const { height } = useWindowDimensions();

  const backdropStyle = useAnimatedStyle(() => {
    // Fade with whichever dismiss gesture is in progress: a vertical
    // drag, or a pinch shrinking the image below natural size.
    const dragProgress = Math.abs(dismissY.value) / (height * 0.5);
    const pinchProgress =
      scale.value < 1 ? (1 - scale.value) / (1 - PINCH_CLOSE_SCALE) : 0;
    const progress = Math.max(dragProgress, pinchProgress);
    return {
      opacity: interpolate(progress, [0, 1], [1, 0.2], Extrapolation.CLAMP),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: 'rgba(0,0,0,0.92)' },
        backdropStyle,
      ]}
    />
  );
}
