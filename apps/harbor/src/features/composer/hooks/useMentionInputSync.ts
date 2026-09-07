import type {
  TextInput,
  TextInputSelectionChangeEvent,
  LayoutChangeEvent,
} from 'react-native';
import { useEffect } from 'react';
import { isAndroid, isWeb } from '@/src/common/util/platform';
import { useMentionStoreApi } from '@/src/features/composer/hooks/useMentionStore';

/**
 * Wires the composer input into its host's mention store: mirrors the draft
 * text, registers the native ref + text sync, measures the input's page
 * position while the route is focused, and hands back the TextArea event
 * handlers that keep selection/focus/layout live.
 */
export function useMentionInputSync({
  text,
  onChangeText,
  inputRef,
}: {
  text: string;
  onChangeText: (next: string) => void;
  inputRef: React.RefObject<TextInput | null>;
}) {
  const store = useMentionStoreApi();

  useEffect(() => {
    // Web: `text` comes from the DOM `input` event and React flushes this
    // effect synchronously inside it, before the `select` event has updated
    // `selection`. Writing only `text` would leave one render with the new
    // text against the old caret, which `findMentionContext` reads as a
    // mid-word caret (overlay blinks). The DOM node's selection is already
    // current, so write both at once. Native delivers both events in one
    // batch, so selection is never stale there.
    const node = isWeb
      ? (inputRef.current as unknown as HTMLTextAreaElement | null)
      : null;
    store.setState(
      node
        ? {
            text,
            selection: { start: node.selectionStart, end: node.selectionEnd },
          }
        : { text },
    );
  }, [store, text, inputRef]);

  useEffect(() => {
    store.setState({ onChangeText });
    return () => store.setState({ onChangeText: null });
  }, [store, onChangeText]);

  // No deps: the TextArea can remount (autoFocus re-key), which swaps
  // `inputRef.current` without any state change — refresh after every commit.
  useEffect(() => {
    store.setState({ inputRef: inputRef.current });
  });
  useEffect(() => () => store.setState({ inputRef: null }), [store]);

  const { setSelection, setIsFocused, setInputLayout, measureInput } =
    store.getState();

  return {
    onSelectionChange: (e: TextInputSelectionChangeEvent) =>
      setSelection(e.nativeEvent.selection),
    onFocus: () => {
      setIsFocused(true);
      // Warm-up measure so the overlay's first frame is usually right; the
      // overlay re-measures on open for the settled layout.
      measureInput();
    },
    onBlur: () => setIsFocused(false),
    onLayout: (e: LayoutChangeEvent) => setInputLayout(e.nativeEvent.layout),
    // Android: Fabric lays out a `setNativeProps` commit before the native
    // field applies the text, so it measures the EditText's stale cached
    // spannable and the field doesn't grow. Native reports the new content
    // size only after refreshing that cache, so re-sending the same prop then
    // (a no-op for the field itself) just re-runs layout against the fresh
    // one. Guarded to the inserted text so a later wrap while typing never
    // pushes stale text into the field.
    onContentSizeChange: () => {
      const { text, lastNativeText, inputRef } = store.getState();
      if (isAndroid && text === lastNativeText) {
        inputRef?.setNativeProps({ text });
      }
    },
  };
}
