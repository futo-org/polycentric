import { Sheet } from '@/src/common/components/sheet';
import { Atoms, useTheme } from '@/src/common/theme';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { categories, getCategory, type EmojiEntry } from './emojiData';
import { Emoji } from './Emoji';

type EmojiPickerSheetProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  selectedEmoji?: string | null;
};

/** Sentinel category key for the unfiltered grid. */
const ALL = 'All';

/** Grid cells stay close to this width; wider sheets get more columns. */
const TARGET_CELL_WIDTH = 60;
const MIN_COLUMNS = 8;

/** Every pickable emoji, in category order. */
const ALL_EMOJIS = categories.flatMap((c) => c.emojis);

const keyExtractor = (item: EmojiEntry) => item.emoji;

/**
 * Emoji picker sheet with a category rail and a scrollable grid, using
 * `FlashList` over the emoji set from `emojiData`.
 */
export function EmojiPickerSheet({
  open,
  onClose,
  onSelect,
  selectedEmoji,
}: EmojiPickerSheetProps) {
  const { theme } = useTheme();
  const listRef = useRef<FlashListRef<EmojiEntry>>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL);

  // Derivied from the sheet width
  const [gridWidth, setGridWidth] = useState(0);

  // Start over from the full grid each time the sheet is reopened.
  useEffect(() => {
    if (open) setSelectedCategory(ALL);
  }, [open]);

  // Scale the column count with the sheet width, keeping cells near
  // TARGET_CELL_WIDTH wide rather than stretching a fixed column count.
  const numColumns = Math.max(
    MIN_COLUMNS,
    Math.floor(gridWidth / TARGET_CELL_WIDTH),
  );
  const colWidth = gridWidth / numColumns;
  const categoryColWidth = gridWidth / categories.length;

  const filteredEmojis = useMemo(
    () =>
      selectedCategory === ALL
        ? ALL_EMOJIS
        : (getCategory(selectedCategory)?.emojis ?? ALL_EMOJIS),
    [selectedCategory],
  );

  const handleCategorySelect = useCallback((key: string) => {
    setSelectedCategory((prev) => (prev === key ? ALL : key));
    listRef.current?.scrollToTop();
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: EmojiEntry }) => (
      <Emoji
        emoji={item.emoji}
        selected={item.emoji === selectedEmoji}
        onSelect={onSelect}
        highlightColor={theme.palette.neutral_100}
        size={colWidth}
      />
    ),
    [onSelect, colWidth, theme, selectedEmoji],
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      detents={[0.5]}
      maxWidth={400}
      header={<Sheet.Header title="Pick a reaction" onClose={onClose} />}
    >
      <Sheet.Content
        scrollable={false}
        style={Atoms.p_0}
        onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
      >
        {gridWidth > 0 && (
          <>
            <View
              style={[
                Atoms.flex_row,
                { borderBottomWidth: 1, borderColor: theme.palette.neutral_25 },
              ]}
            >
              {categories.map((cat) => (
                <Emoji
                  key={cat.key}
                  emoji={cat.icon}
                  value={cat.key}
                  size={categoryColWidth}
                  onSelect={handleCategorySelect}
                  highlightColor={theme.palette.neutral_100}
                  style={
                    cat.key === selectedCategory && {
                      borderBottomWidth: 2,
                      borderBottomColor: theme.palette.primary_500,
                    }
                  }
                />
              ))}
            </View>

            <View style={Atoms.flex_1}>
              <FlashList
                ref={listRef}
                data={filteredEmojis}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                numColumns={numColumns}
                showsVerticalScrollIndicator={false}
              />
            </View>
          </>
        )}
      </Sheet.Content>
    </Sheet>
  );
}
