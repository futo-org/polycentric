import * as DropdownMenuPrimitive from '@rn-primitives/dropdown-menu';
import type { ReactNode, RefAttributes } from 'react';
import { StyleSheet, View } from 'react-native';

import { Atoms, useTheme } from '../theme';

function DropdownMenuContent({
  style,
  ...props
}: DropdownMenuPrimitive.ContentProps &
  RefAttributes<DropdownMenuPrimitive.ContentRef>) {
  const { theme } = useTheme();

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Overlay style={StyleSheet.absoluteFill}>
        <DropdownMenuPrimitive.Content
          style={StyleSheet.flatten([
            { borderWidth: 1, borderColor: theme.palette.neutral_50 },
            Atoms.rounded_lg,
            { minWidth: 225 },
            Atoms.outline_none,
            { backgroundColor: theme.palette.neutral_25 },
            Atoms.overflow_hidden,
            typeof style === 'function' ? undefined : style,
          ])}
          {...props}
        />
      </DropdownMenuPrimitive.Overlay>
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  style,
  children,
  ...props
}: DropdownMenuPrimitive.ItemProps & { children: ReactNode }) {
  const { theme } = useTheme();

  return (
    <DropdownMenuPrimitive.Item style={Atoms.outline_none} {...props}>
      {({ pressed, hovered }) => (
        <View
          style={[
            Atoms.py_md,
            Atoms.px_lg,
            // Press on native mirrors hover on web — same highlight, so items
            // give feedback on touch devices that have no hover state.
            (hovered || pressed) && {
              backgroundColor: theme.palette.neutral_50,
            },
            Atoms.flex_row,
            Atoms.align_center,
            Atoms.gap_lg,
            props.disabled && { opacity: 0.5 },
          ]}
        >
          {children}
        </View>
      )}
    </DropdownMenuPrimitive.Item>
  );
}

function DropdownMenu({ children }: DropdownMenuPrimitive.RootProps) {
  return <DropdownMenuPrimitive.Root>{children}</DropdownMenuPrimitive.Root>;
}
DropdownMenu.Trigger = DropdownMenuPrimitive.Trigger;
DropdownMenu.Content = DropdownMenuContent;
DropdownMenu.Item = DropdownMenuItem;

export default DropdownMenu;
