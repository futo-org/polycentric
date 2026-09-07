import { IconButton, ProfileAvatar, Text } from '@/src/common/components';
import Icon from '@/src/common/components/Icon';
import { Sheet } from '@/src/common/components/sheet';
import { useToast } from '@/src/common/components/toast';
import {
  publicKeyToString,
  useCurrentIdentity,
  usePolycentric,
} from '@/src/common/lib/polycentric-hooks';
import { useCurrentAuthorization } from '@/src/common/lib/polycentric-hooks/useCurrentAuthorization';
import { Atoms, useTheme, withHexOpacity } from '@/src/common/theme';
import { useProfile } from '@/src/features/profile/hooks/useProfile';
import { ServerRow } from '@/src/features/settings/servers/ServerRow';
import { useServerSettings } from '@/src/features/settings/servers/useServerSettings';
import { IdentityManager, type v2 } from '@polycentric/react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, type TextStyle, View } from 'react-native';
import { isWeb } from '@/src/common/util/platform';
import { useIdentityState } from './hooks/useIdentityState';

type KeyEntry = {
  id: string;
  key: v2.PublicKey;
  isThisDevice: boolean;
};

export function ProfileIdentitySheet({ identityKey }: { identityKey: string }) {
  const { theme } = useTheme();
  const client = usePolycentric();
  const profile = useProfile(identityKey);
  const { identityKey: selfKey } = useCurrentIdentity();
  const { state, isLoading } = useIdentityState(identityKey);
  const { servers: ownServers, addServer, isBusy } = useServerSettings();
  const { canRotate } = useCurrentAuthorization();

  const isSelf = selfKey === identityKey;
  const deviceKey = client.currentKeyPair?.publicKey;

  const keys = useMemo<KeyEntry[]>(() => {
    if (!state) return [];
    const entries: KeyEntry[] = [];
    for (const key of [...state.rotationKeys, ...state.signingKeys]) {
      if (entries.some((e) => IdentityManager.keysEqual(e.key, key))) continue;
      entries.push({
        id: publicKeyToString(key),
        key,
        isThisDevice: !!deviceKey && IdentityManager.keysEqual(deviceKey, key),
      });
    }
    return entries;
  }, [state, deviceKey]);

  const servers = state?.servers ?? [];

  const divider = (
    <View
      style={{
        height: 1,
        backgroundColor: withHexOpacity(theme.palette.neutral_500, '20'),
      }}
    />
  );

  return (
    <Sheet detents={[1]} dismissible>
      <Sheet.Header
        title="Identity"
        onClose={() => router.canGoBack() && router.back()}
      />
      <Sheet.Content style={[Atoms.gap_xl]}>
        <View style={[Atoms.items_center, Atoms.gap_md, { paddingTop: 8 }]}>
          <ProfileAvatar identityKey={identityKey} size="massive" />
          <Text
            variant="title"
            fontWeight="bold"
            numberOfLines={2}
            ellipsizeMode="tail"
            style={[Atoms.text_center, Atoms.max_w_full]}
          >
            {profile.name || 'Anonymous'}
          </Text>
        </View>

        <View
          style={[
            Atoms.gap_md,
            Atoms.p_md,
            Atoms.rounded_md,
            {
              backgroundColor: withHexOpacity(theme.palette.neutral_500, '20'),
            },
          ]}
        >
          <View style={Atoms.gap_xs}>
            <Text variant="small" color="neutral_500">
              IDENTITY KEY
            </Text>
            <CopyableValue value={identityKey} label="identity key" />
          </View>

          {divider}

          <View style={Atoms.gap_sm}>
            <Text variant="small" color="neutral_500">
              SIGNING KEYS
            </Text>
            {isLoading && keys.length === 0 ? (
              <ActivityIndicator style={Atoms.self_start} />
            ) : keys.length === 0 ? (
              <Text variant="secondary" color="neutral_500">
                No identity document found
              </Text>
            ) : (
              keys.map((entry) => (
                <SigningKeyRow key={entry.id} entry={entry} isSelf={isSelf} />
              ))
            )}
          </View>
        </View>

        <View style={Atoms.gap_sm}>
          <Text variant="small" color="neutral_500">
            SERVERS
          </Text>
          {isLoading && !state ? (
            <ActivityIndicator style={Atoms.self_start} />
          ) : servers.length === 0 ? (
            <Text variant="secondary" color="neutral_500">
              No servers listed
            </Text>
          ) : (
            servers.map((server) => {
              const shared = ownServers.includes(server);
              return (
                <ServerRow
                  key={server}
                  server={server}
                  status={shared ? 'active' : 'suggested'}
                  onAction={
                    !shared && canRotate && !isBusy
                      ? () => void addServer(server)
                      : undefined
                  }
                  trailing={
                    shared ? (
                      <View style={Atoms.pr_md}>
                        <Icon name="checkmark" size={22} color="positive_500" />
                      </View>
                    ) : undefined
                  }
                />
              );
            })
          )}
        </View>
      </Sheet.Content>
    </Sheet>
  );
}

function SigningKeyRow({
  entry,
  isSelf,
}: {
  entry: KeyEntry;
  isSelf: boolean;
}) {
  const { theme } = useTheme();

  return (
    <View style={Atoms.gap_xs}>
      {isSelf && entry.isThisDevice ? (
        <View
          style={[
            Atoms.self_start,
            Atoms.px_sm,
            Atoms.py_xs,
            Atoms.rounded_full,
            {
              backgroundColor: withHexOpacity(theme.palette.primary_500, '20'),
            },
          ]}
        >
          <Text variant="small" color="primary_500">
            This device
          </Text>
        </View>
      ) : null}
      <CopyableValue value={entry.id} label="signing key" />
    </View>
  );
}

function CopyableValue({ value, label }: { value: string; label: string }) {
  const toast = useToast();

  const onCopy = () => {
    void Clipboard.setStringAsync(value);
    toast.success('Copied to clipboard');
  };

  return (
    <View style={[Atoms.flex_row, Atoms.items_center, Atoms.gap_sm]}>
      <Text
        variant="secondary"
        style={[
          Atoms.flex_1,
          { fontFamily: 'monospace', minWidth: 0 },
          isWeb && ({ wordBreak: 'break-all' } as unknown as TextStyle),
        ]}
        selectable
      >
        {value}
      </Text>
      <IconButton
        variant="ghost"
        compact
        accessibilityLabel={`Copy ${label}`}
        icon={() => <Icon name="copy" size={16} color="neutral_500" />}
        onPress={onCopy}
      />
    </View>
  );
}

export default function ProfileIdentityScreen() {
  const { identityId } = useLocalSearchParams<{ identityId: string }>();
  if (!identityId) return null;
  return <ProfileIdentitySheet identityKey={identityId} />;
}
