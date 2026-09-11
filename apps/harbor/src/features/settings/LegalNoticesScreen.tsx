import {
  LinkButton,
  ListItem,
  ListItemGroup,
  Screen,
  ScreenHeader,
  Text,
} from '@/src/common/components';
import { usePageTitle } from '@/src/common/lib/navigation/usePageTitle';
import { Atoms, Spacing, useTheme } from '@/src/common/theme';
import { router } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LEGAL_NOTICES, type LegalNotice } from './legalNotices';

function NoticeGroup({ notice }: { notice: LegalNotice }) {
  return (
    <ListItemGroup label={notice.name}>
      <ListItem pressable={false}>
        <View style={[Atoms.gap_sm, Atoms.pl_xs]}>
          <Text variant="body">{notice.attribution}</Text>
          <View style={[Atoms.flex_row, Atoms.gap_lg]}>
            <LinkButton
              title={notice.name}
              onPress={() => Linking.openURL(notice.url)}
              underlineOnHover
            />
            <LinkButton
              title={notice.license}
              onPress={() => Linking.openURL(notice.licenseUrl)}
              underlineOnHover
            />
          </View>
          {notice.licenseText ? (
            <Text variant="small" fontWeight="regular" color="neutral_600">
              {notice.licenseText}
            </Text>
          ) : null}
        </View>
      </ListItem>
    </ListItemGroup>
  );
}

export default function LegalNoticesScreen() {
  usePageTitle('Legal notices');
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <Screen.PrimaryColumn>
        <View
          style={[
            Atoms.px_lg,
            Atoms.flex_1,
            { backgroundColor: theme.atoms.bg.backgroundColor },
          ]}
        >
          <ScreenHeader title="Legal notices" onBack={() => router.back()} />
          <ScrollView
            style={Atoms.flex_1}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              Atoms.gap_xl,
              { paddingBottom: insets.bottom + Spacing['4xl'] },
            ]}
          >
            {LEGAL_NOTICES.map((notice) => (
              <NoticeGroup key={notice.name} notice={notice} />
            ))}
          </ScrollView>
        </View>
      </Screen.PrimaryColumn>
    </Screen>
  );
}
