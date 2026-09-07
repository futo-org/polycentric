import { usePolycentric } from '@/src/common/lib/polycentric-hooks';
import { Atoms, useTheme, withHexOpacity, Spacing } from '@/src/common/theme';
import Icon from '@/src/common/components/Icon';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  resolveImageSources,
  type ImageViewerInput,
} from './resolveImageSources';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageViewerBackdrop } from './components/ImageViewerBackdrop';
import { ImagePane } from './components/ImagePane';
import { NavArrow } from './components/NavArrow';
import { useImageViewerGestures } from './hooks/useImageViewerGestures';
import { NavDots } from '@/src/common/components/ImageViewer/components/NavDots';
import { isWeb } from '@/src/common/util/platform';

/**
 * Full-screen viewer for any `ImageSet`s (post attachments, avatars,
 * ...). Tap the backdrop or
 * the close button to dismiss; pinch in or swipe up/down to close;
 * swipe left/right, use left/right arrows or keyboard arrows to navigate
 * between images when there's more than one.
 */
export function ImageViewer({
  images,
  initialIndex,
  onClose,
  onIndexChange,
}: {
  images: ImageViewerInput[];
  initialIndex: number;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}) {
  // Don't show nav arrows on devices where primary input is touch-based since
  // swiping is preferable then
  const [showNavArrows] = useState(
    () => isWeb && !matchMedia('(pointer: coarse)').matches,
  );

  const client = usePolycentric();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const sources = useMemo(
    () => resolveImageSources(images, (digest) => client.blobUrls(digest)),
    [client, images],
  );

  const [index, setIndex] = useState(initialIndex);
  const count = sources.length;
  const safeIndex = Math.min(index, count - 1);

  const { height, width } = useWindowDimensions();

  // Strip position
  const offsetX = useSharedValue(-initialIndex * width);

  // Snap offset to correct index if changed from the outside
  useEffect(() => {
    setIndex((prev) => {
      if (initialIndex === prev) return prev;

      offsetX.value = -initialIndex * width;
      return initialIndex;
    });
  }, [initialIndex, offsetX, width]);

  // Keep the strip position up-to-date
  // biome-ignore lint/correctness/useExhaustiveDependencies: only width/count changes should snap; safeIndex is read fresh
  useEffect(() => {
    offsetX.value = -Math.max(0, safeIndex) * width;
  }, [width, count]);

  const goTo = useCallback(
    (i: number) => {
      setIndex(i);
      offsetX.value = withTiming(-i * width, { duration: 200 });
    },
    [offsetX, width],
  );
  const goPrev = useCallback(
    () => goTo(Math.max(0, safeIndex - 1)),
    [goTo, safeIndex],
  );
  const goNext = useCallback(
    () => goTo(Math.min(count - 1, safeIndex + 1)),
    [goTo, safeIndex, count],
  );

  // Report arrow/keyboard navigation, skipping the mount-time index.
  const firstMount = useRef(true);
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    onIndexChange?.(index);
  }, [index, onIndexChange]);

  // Web: Esc closes, arrow keys navigate.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, goPrev, goNext]);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dismissY = useSharedValue(0);

  const aspectRatio = sources[safeIndex]?.aspectRatio ?? 1;

  // Detector's full-screen layout, for the backdrop-tap hit test.
  const containerSize = useSharedValue({ w: 0, h: 0 });

  const gesture = useImageViewerGestures({
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
  });

  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < count - 1;

  const chipBg = withHexOpacity(theme.palette.black, 'b0');

  // Rendered by the image-viewer routes (post images, profile photo),
  // declared with `orientation: 'all'`, so it rotates to landscape and
  // fills the screen while the rest of the app stays portrait. The route
  // provides the (transparent-modal) presentation; here we just fill it.
  return (
    <GestureHandlerRootView style={Atoms.flex_1}>
      <ImageViewerBackdrop scale={scale} dismissY={dismissY} />
      <GestureDetector gesture={gesture}>
        <View
          style={[Atoms.flex_1, Atoms.overflow_hidden]}
          onLayout={(e) => {
            containerSize.value = {
              w: e.nativeEvent.layout.width,
              h: e.nativeEvent.layout.height,
            };
          }}
        >
          {sources.map((source, i) => (
            <ImagePane
              // biome-ignore lint/suspicious/noArrayIndexKey: panes are positional slots in the strip and never reorder
              key={`${i}-${source.uris[0]}`}
              source={source}
              paneX={i * width}
              isCurrent={i === safeIndex}
              offsetX={offsetX}
              scale={scale}
              translateX={translateX}
              translateY={translateY}
              dismissY={dismissY}
            />
          ))}
        </View>
      </GestureDetector>

      <Pressable
        onPress={onClose}
        accessibilityLabel="Close image viewer"
        hitSlop={12}
        style={[
          Atoms.absolute,
          Atoms.items_center,
          Atoms.justify_center,
          Atoms.rounded_full,
          {
            top: insets.top,
            right: 16,
            width: 40,
            height: 40,
            backgroundColor: chipBg,
          },
        ]}
      >
        <Icon name="close" size={24} color="white" />
      </Pressable>

      {showNavArrows && (
        <>
          {hasPrev && <NavArrow side="left" onPress={goPrev} bg={chipBg} />}
          {hasNext && <NavArrow side="right" onPress={goNext} bg={chipBg} />}
        </>
      )}

      {count > 1 && (
        <View
          style={[
            Atoms.absolute,
            Atoms.items_center,
            { bottom: insets.bottom + Spacing.lg, left: 0, right: 0 },
          ]}
          pointerEvents="none"
        >
          <NavDots count={count} offset={offsetX} width={width} />
        </View>
      )}
    </GestureHandlerRootView>
  );
}
