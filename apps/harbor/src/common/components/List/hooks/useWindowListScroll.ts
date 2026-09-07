import {
  measureElement,
  useWindowVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from '@tanstack/react-virtual';
import { useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const ESTIMATED_ITEM_HEIGHT = 150;

// The browser's popstate restoration applies stale offsets over ours.
if (typeof history !== 'undefined') {
  history.scrollRestoration = 'manual';
}

/** Scroll state of unmounted lists. In memory, so a reload starts at the top. */
const savedStates = new Map<
  string,
  { offset: number; measurements: VirtualItem[] }
>();

// A hidden-but-mounted screen reports every row as zero-high.
function measureVisibleRow(
  element: Element,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<Window, Element>,
) {
  const size = measureElement(element, entry, instance);
  if (size > 0) return size;
  const key = instance.options.getItemKey(instance.indexFromElement(element));
  return instance.itemSizeCache.get(key) ?? ESTIMATED_ITEM_HEIGHT;
}

type ScrollOptions<T> = {
  items: readonly T[];
  keyExtractor?: (item: T, index: number) => string;
  /** Page offset of the rows, i.e. everything rendered above them. */
  scrollMargin: number;
  containerRef: RefObject<HTMLDivElement | null>;
  headerRef: RefObject<unknown>;
  headerHeight: number;
  restorationKey?: string;
  /** Row to hold at the top, like native's `initialScrollIndex`. */
  anchorIndex?: number | null;
};

/** The window virtualizer plus its scroll behaviour. */
export function useWindowListScroll<T>({
  items,
  keyExtractor,
  scrollMargin,
  containerRef,
  headerRef,
  headerHeight,
  restorationKey,
  anchorIndex,
}: ScrollOptions<T>) {
  const isEmpty = items.length === 0;
  const restored = useRef(
    restorationKey ? savedStates.get(restorationKey) : undefined,
  ).current;

  // Row heights vary, so each rendered row is measured via `measureElement`.
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 8,
    scrollMargin,
    initialOffset: restored?.offset,
    initialMeasurementsCache: restored?.measurements,
    // `flushSync` would cost a list render per row, and React warns.
    useFlushSync: false,
    useAnimationFrameWithResizeObserver: true,
    measureElement: measureVisibleRow,
    getItemKey: (index) =>
      typeof keyExtractor === 'function'
        ? keyExtractor(items[index], index)
        : index,
  });

  const liveHeaderHeight = () =>
    (headerRef.current as HTMLElement | null)?.offsetHeight ?? headerHeight;

  useSaveOnUnmount(restorationKey, virtualizer);
  const cancelled = useCancelOnUserScroll();
  useRestoreSavedOffset(restored?.offset, isEmpty, items.length, cancelled);
  const anchorSpace = useAnchoredRow({
    virtualizer,
    anchorIndex:
      typeof anchorIndex === 'number' && anchorIndex > 0
        ? anchorIndex
        : undefined,
    isEmpty,
    containerRef,
    scrollMargin,
    headerHeight,
    liveHeaderHeight,
    cancelled,
  });
  const isFocused = useRestoreOnRefocus(virtualizer, containerRef, isEmpty);
  const frozen = useFrozenRows(virtualizer.getVirtualItems(), items, isFocused);

  return {
    virtualizer,
    rows: frozen.rows,
    rowItems: frozen.items,
    anchorSpace,
  };
}

function useSaveOnUnmount(
  restorationKey: string | undefined,
  virtualizer: Virtualizer<Window, Element>,
) {
  useEffect(() => {
    if (!restorationKey) return;
    return () => {
      savedStates.set(restorationKey, {
        offset: virtualizer.scrollOffset ?? 0,
        measurements: virtualizer.measurementsCache,
      });
    };
  }, [restorationKey, virtualizer]);
}

/** Set once the user takes over the scroll. */
function useCancelOnUserScroll() {
  const cancelled = useRef(false);
  useEffect(() => {
    const cancel = () => {
      cancelled.current = true;
    };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchstart', cancel, { passive: true });
    return () => {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
    };
  }, []);
  return cancelled;
}

function useRestoreSavedOffset(
  offset: number | undefined,
  isEmpty: boolean,
  itemCount: number,
  cancelled: RefObject<boolean>,
) {
  // The offset can sit below the loaded rows, so retry as pages land.
  const pending = useRef(offset);
  // biome-ignore lint/correctness/useExhaustiveDependencies: itemCount retries the restore as pages land
  useLayoutEffect(() => {
    const target = pending.current;
    if (isEmpty || target === undefined || cancelled.current) return;
    window.scrollTo(0, target);
    if (window.scrollY >= target - 1) pending.current = undefined;
  }, [isEmpty, itemCount]);
}

function useAnchoredRow({
  virtualizer,
  anchorIndex,
  isEmpty,
  containerRef,
  scrollMargin,
  headerHeight,
  liveHeaderHeight,
  cancelled,
}: {
  virtualizer: Virtualizer<Window, Element>;
  anchorIndex: number | undefined;
  isEmpty: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  scrollMargin: number;
  headerHeight: number;
  liveHeaderHeight: () => number;
  cancelled: RefObject<boolean>;
}) {
  // From the DOM, before paint: the virtualizer's offsets lag a frame
  // behind rows arriving above.
  const applied = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (anchorIndex === undefined || cancelled.current) return;
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-index="${anchorIndex}"]`,
    );
    if (!row) return;
    const top = row.getBoundingClientRect().top + window.scrollY;
    const target = Math.max(0, top - liveHeaderHeight());
    // Unchanged means the row has not moved, so leave the scroll alone.
    if (applied.current === target) return;
    applied.current = target;
    virtualizer.scrollToOffset(target);
  });

  if (anchorIndex === undefined || isEmpty) return 0;
  // Room for the anchored row to reach the top. Reserve a viewport until
  // the row is measured, or the scroll above clamps to a short page.
  const anchorStart = virtualizer.measurementsCache[anchorIndex]?.start;
  const room = window.innerHeight - headerHeight;
  if (anchorStart === undefined) return room;
  const below = scrollMargin + virtualizer.getTotalSize() - anchorStart;
  return Math.max(0, room - below);
}

function useRestoreOnRefocus(
  virtualizer: Virtualizer<Window, Element>,
  containerRef: RefObject<HTMLDivElement | null>,
  isEmpty: boolean,
) {
  // By the time blur fires the window has clamped to the new route.
  const focusedScrollY = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      if (containerRef.current?.offsetParent === null) return;
      focusedScrollY.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [containerRef]);

  const blurredAt = useRef<number | undefined>(undefined);
  const isFocused = useIsFocused();
  const wasFocused = useRef(isFocused);
  useLayoutEffect(() => {
    if (isFocused === wasFocused.current) return;
    wasFocused.current = isFocused;
    if (!isFocused) {
      blurredAt.current = focusedScrollY.current;
      return;
    }
    const offset = blurredAt.current;
    blurredAt.current = undefined;
    // A plain window scroll reaches the virtualizer a frame late.
    if (offset !== undefined) virtualizer.scrollToOffset(offset);
  }, [isFocused, virtualizer]);

  // Focus lands a frame after the screen is shown; the container
  // regaining its size is the pre-paint signal.
  useEffect(() => {
    const el = containerRef.current;
    if (isEmpty || !el) return;
    const observer = new ResizeObserver(() => {
      const offset = blurredAt.current;
      if (offset === undefined || el.offsetParent === null) return;
      blurredAt.current = undefined;
      virtualizer.scrollToOffset(offset);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, isEmpty, virtualizer]);

  return isFocused;
}

/** Rows and their items from the last focused render, so the restored frame
 *  matches. The items may shrink while hidden, so the rows index that snapshot. */
function useFrozenRows<T>(
  virtualItems: VirtualItem[],
  items: readonly T[],
  isFocused: boolean,
) {
  const frozen = useRef<{ rows: VirtualItem[]; items: readonly T[] } | null>(
    null,
  );
  if (isFocused) {
    frozen.current = null;
  } else {
    frozen.current ??= { rows: virtualItems, items };
  }
  return frozen.current ?? { rows: virtualItems, items };
}
