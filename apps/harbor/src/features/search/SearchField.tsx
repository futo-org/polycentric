import {
  Atoms,
  BorderRadius,
  useTheme,
  withHexOpacity,
} from '@/src/common/theme';
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

type SearchFieldProps = {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button';
};

export function SearchField({
  children,
  onPress,
  accessibilityLabel,
  accessibilityRole,
}: SearchFieldProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[
        Atoms.flex_row,
        Atoms.align_center,
        Atoms.w_full,
        Atoms.gap_sm,
        Atoms.px_md,
        {
          height: 40,
          borderRadius: BorderRadius.full,
          backgroundColor: withHexOpacity(theme.palette.neutral_500, '20'),
        },
      ]}
    >
      {children}
    </Pressable>
  );
}
