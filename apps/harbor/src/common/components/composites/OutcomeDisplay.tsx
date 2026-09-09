import { Text } from '@/src/common/components/primitives';
import Icon from '@/src/common/components/Icon';
import { Atoms } from '@/src/common/theme';
import { View } from 'react-native';

export type DisplayStatus = 'success' | 'error';

export interface OutcomeDisplayProps {
  /** Determines which icon to display. */
  status: DisplayStatus;
  /** Text to display under the icon. */
  message: string;
}

/** Prominently display a status indicator and message to the user. */
export function OutcomeDisplay({ status, message }: OutcomeDisplayProps) {
  const successful = status === 'success';
  const iconName = successful ? 'checkmarkCircle' : 'closeCircle';
  const iconColor = successful ? 'primary_500' : 'negative_500';

  return (
    <View style={[Atoms.py_2xl, Atoms.items_center, Atoms.gap_md]}>
      <Icon name={iconName} size={72} color={iconColor} />
      <Text variant="subtitle" style={Atoms.text_center}>
        {message}
      </Text>
    </View>
  );
}
