import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AVATAR_SIZE_MAP } from '@/src/common/components';
import { Atoms, Spacing, useTheme, ZIndex } from '@/src/common/theme';
import { ProfileRow } from '@/src/features/profile/ProfileRow';
import { useMentionStore } from '../hooks/useMentionStore';
import { useMentionSearch } from '../hooks/useMentionSearch';

/**
 * Mention autocomplete results, anchored below the composer's input. Fully
 * self-contained: reads the live input state from the host's mention store
 * (see `MentionProvider`), searches, and inserts the tapped mention. Mount it
 * in the composer host, as a sibling of the fields container.
 */
export function MentionSearchOverlay() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const inputHeight = useMentionStore((state) => state.inputLayout.height);
  const inputPageY = useMentionStore((state) => state.inputPageY);
  const insertMention = useMentionStore((state) => state.insertMention);
  const { open, entries } = useMentionSearch();

  const measureInput = useMentionStore((state) => state.measureInput);

  // Measure when opening, not at input mount: by now the layout above the
  // input (reply preview) has settled, so the anchor is correct.
  useEffect(() => {
    if (open) measureInput();
  }, [open, measureInput]);

  if (!open) return null;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          top:
            Math.max(inputHeight, AVATAR_SIZE_MAP.md) +
            Spacing.md +
            (inputPageY - insets.top),
          zIndex: ZIndex.raised,
        },
        {
          backgroundColor: theme.palette.neutral_0,
          borderTopWidth: 1,
          borderColor: theme.palette.neutral_25,
        },
      ]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={Atoms.gap_lg}
        style={[Atoms.flex_1, Atoms.p_lg]}
      >
        {entries.map((user) => (
          <ProfileRow
            key={user.identity}
            identity={user.identity}
            onPress={insertMention}
            activeStyle="none"
            style={[Atoms.px_0, Atoms.py_0]}
          />
        ))}
      </ScrollView>
    </View>
  );
}
