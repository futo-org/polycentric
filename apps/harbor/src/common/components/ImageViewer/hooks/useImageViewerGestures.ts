import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import {
  AXIS_LOCK_SLOP,
  CLOSE_DISTANCE,
  CLOSE_VELOCITY,
  MAX_SCALE,
  PANE_HEIGHT,
  PINCH_CLOSE_SCALE,
  SWIPE_VELOCITY,
  DOUBLE_TAP_ZOOM_THRESHOLD,
} from '../constants';

export function useImageViewerGestures({
  onClose,
  index,
  safeIndex,
  setIndex,
  count,
  width,
  height,
  aspectRatio,
  offsetX,
  scale,
  translateX,
  translateY,
  dismissY,
  containerSize,
}: {
  onClose: () => void;
  index: number;
  safeIndex: number;
  setIndex: Dispatch<SetStateAction<number>>;
  count: number;
  width: number;
  height: number;
  aspectRatio: number;
  offsetX: SharedValue<number>;
  scale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  dismissY: SharedValue<number>;
  containerSize: SharedValue<{ w: number; h: number }>;
}) {
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // Drag axis, swipe ('x') vs dismiss ('y')
  const axis = useSharedValue<'none' | 'x' | 'y'>('none');
  // Strip position when a horizontal drag locked in, so a grab during a
  // settle animation continues from where the strip is, not a jump.
  const swipeStartX = useSharedValue(0);

  // Reset zoom/pan whenever the displayed image changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `index` is the reset trigger, not a capture
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    dismissY.value = 0;
  }, [
    index,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    dismissY,
  ]);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          // If we're swiping, prohibit zooming
          if (axis.value === 'x') return;

          scale.value = Math.min(savedScale.value * e.scale, MAX_SCALE);
        })
        .onEnd(() => {
          if (scale.value < PINCH_CLOSE_SCALE) {
            // Pinched in far enough — shrink away and dismiss.
            scale.value = withTiming(0.3, { duration: 180 }, (finished) => {
              if (finished) runOnJS(onClose)();
            });
          } else if (scale.value <= 1) {
            scale.value = withTiming(1);
            savedScale.value = 1;
            translateX.value = withTiming(0);
            translateY.value = withTiming(0);
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
          } else {
            savedScale.value = scale.value;
          }
        }),
    [
      onClose,
      scale,
      savedScale,
      translateX,
      translateY,
      savedTranslateX,
      savedTranslateY,
      axis,
    ],
  );

  const swipeEnabled = count > 1;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          if (scale.value > 1) {
            translateX.value = savedTranslateX.value + e.translationX;
            translateY.value = savedTranslateY.value + e.translationY;
            return;
          }

          // Only act at natural size; ignore the centroid drift while a
          // pinch is shrinking the image.
          if (scale.value < 1) return;

          // Lock to the pan axis
          if (axis.value === 'none') {
            const ax = Math.abs(e.translationX);
            const ay = Math.abs(e.translationY);
            if (Math.max(ax, ay) < AXIS_LOCK_SLOP) return;
            axis.value = swipeEnabled && ax > ay ? 'x' : 'y';
            if (axis.value === 'x') {
              swipeStartX.value = offsetX.value - e.translationX;
            }
          }

          // Swipe
          if (axis.value === 'x') {
            const raw = swipeStartX.value + e.translationX;
            const min = -(count - 1) * width;
            const clamped = Math.min(0, Math.max(min, raw));
            // Rubber-band when dragging past the first/last image.
            offsetX.value = clamped + (raw - clamped) / 3;
          }
          // Dismiss
          else {
            dismissY.value = e.translationY;
          }
        })
        .onEnd((e) => {
          if (scale.value > 1) {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
            // Settle the strip in case a pinch interrupted a swipe.
            offsetX.value = withTiming(-safeIndex * width, { duration: 200 });
            return;
          }
          if (scale.value < 1) {
            // A pinch-to-close is in progress; let the pinch decide
            // whether to dismiss, so we don't double-fire onClose (which
            // on Android popped an extra screen).
            dismissY.value = withTiming(0, { duration: 150 });
            return;
          }

          // Swipe
          if (axis.value === 'x') {
            // A fling commits to the neighbor in its direction; otherwise
            // commit once the drag passed a third of the screen.
            let target: number;

            if (Math.abs(e.velocityX) > SWIPE_VELOCITY) {
              target = e.velocityX < 0 ? safeIndex + 1 : safeIndex - 1;
            } else {
              const progress = -offsetX.value / width - safeIndex;
              target =
                progress > 1 / 3
                  ? safeIndex + 1
                  : progress < -1 / 3
                    ? safeIndex - 1
                    : safeIndex;
            }

            target = Math.max(0, Math.min(count - 1, target));
            offsetX.value = withTiming(-target * width, { duration: 200 });

            if (target !== safeIndex) runOnJS(setIndex)(target);
          }
          // Dismiss
          else {
            const dismiss =
              Math.abs(e.translationY) > CLOSE_DISTANCE ||
              Math.abs(e.velocityY) > CLOSE_VELOCITY;

            if (dismiss) {
              const target = e.translationY >= 0 ? height : -height;
              dismissY.value = withTiming(
                target,
                { duration: 180 },
                (finished) => {
                  if (finished) runOnJS(onClose)();
                },
              );
            } else {
              dismissY.value = withTiming(0, { duration: 150 });
            }
          }
        })
        .onFinalize(() => {
          axis.value = 'none';
        }),
    [
      swipeEnabled,
      safeIndex,
      count,
      width,
      height,
      onClose,
      setIndex,
      scale,
      translateX,
      translateY,
      savedTranslateX,
      savedTranslateY,
      dismissY,
      offsetX,
      axis,
      swipeStartX,
    ],
  );

  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd((e) => {
        // Contain-fit rect of the current image inside its pane (the pane
        // is PANE_HEIGHT of the container, letterboxing inside it), mapped
        // through the current transform: strip offset (0 when settled),
        // scale about the center, then translate. Taps outside that rect
        // dismiss the viewer.
        const fittedWidth = Math.min(
          containerSize.value.w,
          containerSize.value.h * PANE_HEIGHT * aspectRatio,
        );
        const fittedHeight = fittedWidth / aspectRatio;
        const currentScale = scale.value;
        const imgCenterX =
          containerSize.value.w / 2 +
          offsetX.value +
          safeIndex * width +
          translateX.value;
        const imgCenterY =
          containerSize.value.h / 2 + translateY.value + dismissY.value;

        const tappedOnImage =
          Math.abs(e.x - imgCenterX) <= (fittedWidth * currentScale) / 2 &&
          Math.abs(e.y - imgCenterY) <= (fittedHeight * currentScale) / 2;

        if (!tappedOnImage) runOnJS(onClose)();
      }),
    [
      aspectRatio,
      containerSize,
      onClose,
      scale,
      translateX,
      translateY,
      dismissY,
      offsetX,
      safeIndex,
      width,
    ],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(150)
        .onEnd(() => {
          if (scale.value === 1) return;

          if (scale.value >= DOUBLE_TAP_ZOOM_THRESHOLD) {
            scale.value = withTiming(1);
            savedScale.value = 1;
            translateX.value = withTiming(0);
            translateY.value = withTiming(0);
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
          }
        }),
    [
      savedScale,
      savedTranslateX,
      savedTranslateY,
      scale,
      translateX,
      translateY,
    ],
  );

  return useMemo(
    () =>
      Gesture.Race(
        Gesture.Exclusive(doubleTap, tap),
        Gesture.Simultaneous(pinch, pan),
      ),
    [tap, pinch, pan, doubleTap],
  );
}
