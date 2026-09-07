import * as RadioGroupPrimitive from '@rn-primitives/radio-group';
import { useState } from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type MouseEvent,
  type PressableStateCallbackType,
} from 'react-native';
import { Atoms, Spacing, useTheme } from '../../theme';

function RadioGroup({ style, ...props }: RadioGroupPrimitive.RootProps) {
  return (
    <RadioGroupPrimitive.Root
      {...props}
      style={StyleSheet.flatten([style, props.disabled && { opacity: 0.5 }])}
    />
  );
}

function RadioItem({
  style,
  onHoverIn,
  onHoverOut,
  onPressIn,
  onPressOut,
  ...props
}: RadioGroupPrimitive.ItemProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const resolved =
    typeof style === 'function'
      ? style({
          hovered,
          pressed,
          focused: false,
        } as PressableStateCallbackType)
      : style;

  return (
    <RadioGroupPrimitive.Item
      {...props}
      onHoverIn={(e: MouseEvent) => {
        setHovered(true);
        onHoverIn?.(e);
      }}
      onHoverOut={(e: MouseEvent) => {
        setHovered(false);
        onHoverOut?.(e);
      }}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={StyleSheet.flatten(resolved)}
    />
  );
}

function RadioIndicator() {
  const { theme } = useTheme();
  return (
    <View
      style={[
        Atoms.items_center,
        Atoms.justify_center,
        {
          width: Spacing['xl'],
          height: Spacing['xl'],
          borderRadius: Spacing['md'],
          borderWidth: Spacing['2xs'],
          borderColor: theme.palette.neutral_500,
        },
      ]}
    >
      <RadioGroupPrimitive.Indicator>
        <View
          style={{
            width: Spacing['md'],
            height: Spacing['md'],
            borderRadius: Spacing['sm'],
            backgroundColor: theme.palette.primary_500,
          }}
        />
      </RadioGroupPrimitive.Indicator>
    </View>
  );
}

RadioGroup.Item = RadioItem;
RadioGroup.Indicator = RadioIndicator;

export default RadioGroup;
