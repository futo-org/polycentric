import type React from 'react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Atoms, ZIndex } from '../../theme';
import { renderNode } from '../HidingHeader';
import { useWindowListScroll } from './hooks/useWindowListScroll';
import type { ListProps, ListRef } from './types';

// Call onEndReached once the last rendered row is within this many rows of
// the end, roughly two viewports like the native onEndReachedThreshold.
const END_REACHED_BUFFER = 12;

export const List = forwardRef(function List<T>(
  props: ListProps<T>,
  ref: React.Ref<ListRef>,
) {
  return <WebList<T> {...props} listRef={ref} />;
}) as <T>(
  props: ListProps<T> & { ref?: React.Ref<ListRef> },
) => React.ReactElement;

function WebList<T>({
  data,
  renderItem,
  keyExtractor,
  HeaderComponent,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  onEndReached,
  onLoad,
  contentContainerStyle,
  listRef,
  restorationKey,
  initialScrollIndex,
}: ListProps<T> & { listRef?: React.Ref<ListRef> }) {
  const items = (data as readonly T[] | null | undefined) ?? [];
  const isEmpty = items.length === 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<React.ComponentRef<typeof View>>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // The rows sit at a page offset; the container exists only with rows.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (isEmpty || !containerRef.current) return;
    setScrollMargin(
      containerRef.current.getBoundingClientRect().top + window.scrollY,
    );
  }, [isEmpty]);

  const { virtualizer, rows, rowItems, anchorSpace } = useWindowListScroll({
    items,
    keyExtractor,
    scrollMargin,
    containerRef,
    headerRef,
    headerHeight,
    restorationKey,
    anchorIndex: initialScrollIndex,
  });

  useImperativeHandle(
    listRef,
    () => ({
      scrollToTop: ({ animated = true } = {}) => {
        window.scrollTo({ top: 0, behavior: animated ? 'smooth' : 'auto' });
      },
    }),
    [],
  );

  // FlashList parity. Before paint, so gated items never flash.
  const hasFiredOnLoad = useRef(false);
  useLayoutEffect(() => {
    if (hasFiredOnLoad.current) return;
    hasFiredOnLoad.current = true;
    onLoad?.({ elapsedTimeInMs: 0 });
  }, [onLoad]);

  const lastRenderedIndex = rows.length ? rows[rows.length - 1].index : -1;
  useEffect(() => {
    if (
      lastRenderedIndex >= 0 &&
      lastRenderedIndex >= items.length - 1 - END_REACHED_BUFFER
    ) {
      onEndReached?.();
    }
  }, [lastRenderedIndex, items.length, onEndReached]);

  return (
    <View style={[Atoms.flex_1, contentContainerStyle]}>
      {HeaderComponent ? (
        <View
          ref={headerRef}
          style={[Atoms.sticky, { top: 0, zIndex: ZIndex.raised }]}
          onLayout={(event: LayoutChangeEvent) =>
            setHeaderHeight(event.nativeEvent.layout.height)
          }
        >
          {renderNode(HeaderComponent)}
        </View>
      ) : null}
      {renderNode(ListHeaderComponent)}
      {isEmpty ? (
        renderNode(ListEmptyComponent)
      ) : (
        <div
          ref={containerRef}
          style={{
            height: virtualizer.getTotalSize(),
            // RNW ancestors are column flex containers; without this the
            // spacer height gets flex-shrunk down to the viewport.
            flexShrink: 0,
            position: 'relative',
            width: '100%',
          }}
        >
          {rows.map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start - scrollMargin}px)`,
              }}
            >
              {renderItem?.({
                item: rowItems[row.index],
                index: row.index,
                target: 'Cell',
                extraData: undefined,
              }) ?? null}
            </div>
          ))}
        </div>
      )}
      {anchorSpace > 0 ? (
        <div style={{ height: anchorSpace, flexShrink: 0 }} />
      ) : null}
      {renderNode(ListFooterComponent)}
    </View>
  );
}
