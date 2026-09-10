import { Stack } from 'expo-router';

const sheetScreenOptions = {
  presentation: 'transparentModal',
  animation: 'none',
  contentStyle: { backgroundColor: 'transparent' },
} as const;

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="identity" options={sheetScreenOptions} />
      <Stack.Screen name="pair-identity" />
      <Stack.Screen name="create-backup" />
      <Stack.Screen name="check-backup" />
      <Stack.Screen name="servers" options={sheetScreenOptions} />
      <Stack.Screen name="moderation-settings" options={sheetScreenOptions} />
      <Stack.Screen name="blocked-users" options={sheetScreenOptions} />
      <Stack.Screen name="legal-notices" />
    </Stack>
  );
}
