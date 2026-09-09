import { Text } from '@/src/common/components';
import Icon from '@/src/common/components/Icon';
import { Atoms } from '@/src/common/theme';
import { View } from 'react-native';

export interface BackupStatusProps {
  /** Determines which icon to display. */
  successful: boolean;
  /** Text to display under the icon. */
  message: string;
}

/** Main content for a status screen showing either success or failure. */
export function BackupStatus({ successful, message }: BackupStatusProps) {
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
