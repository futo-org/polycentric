import { Text } from '@/src/common/components/primitives/Text';
import { ProfileAvatar } from '@/src/common/components/Avatar/ProfileAvatar';
import {
  shortenIdentityId,
  truncateName,
} from '@/src/common/lib/polycentric-hooks';
import { Atoms, useTheme } from '@/src/common/theme';
import { useProfile, type ProfileHookResult } from './hooks/useProfile';
import type { FetchMode } from '@polycentric/react-native';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';

/**
 * A pressable identity row: avatar, name, and alias/shortened-id subtitle,
 * with an optional trailing element. Runs edge to edge (the hover
 * background spans the full width) with the standard horizontal inset.
 */
export function ProfileRow({
  identity,
  onPress,
  trailing,
  size = 'md',
  fetchMode,
  fallbackName,
  fallbackAlias,
  disabled,
  activeStyle = 'highlight',
  style,
}: {
  identity: string;
  onPress?: (identity: string, profile: ProfileHookResult) => void;
  trailing?: ReactNode;
  size?: 'sm' | 'md';
  fetchMode?: FetchMode;
  /** Shown when the profile has no cached name/alias yet. */
  fallbackName?: string | null;
  fallbackAlias?: string | null;
  disabled?: boolean;
  activeStyle?: 'highlight' | 'none';
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const profile = useProfile(identity, { fetchMode });
  const name = profile.name ?? fallbackName;
  const alias = profile.alias ?? fallbackAlias;

  return (
    <Pressable
      onPress={() => onPress?.(identity, profile)}
      disabled={disabled}
      style={({ hovered, pressed }) => [
        (hovered || pressed) &&
          activeStyle === 'highlight' && {
            backgroundColor: theme.palette.neutral_25,
          },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View
        style={[
          Atoms.flex_row,
          Atoms.align_center,
          Atoms.gap_md,
          Atoms.px_lg,
          size === 'sm' ? Atoms.py_sm : Atoms.py_md,
          style,
        ]}
      >
        <ProfileAvatar identityKey={identity} size={size} />
        <View style={Atoms.flex_1}>
          <Text
            variant="secondary"
            fontWeight="semibold"
            numberOfLines={1}
            selectable={false}
          >
            {name ? truncateName(name, 32) : 'Anonymous'}
          </Text>
          <Text
            variant="small"
            color="neutral_500"
            numberOfLines={1}
            selectable={false}
            style={alias ? undefined : { fontFamily: 'monospace' }}
          >
            {alias ?? shortenIdentityId(identity)}
          </Text>
        </View>
        {trailing}
      </View>
    </Pressable>
  );
}
