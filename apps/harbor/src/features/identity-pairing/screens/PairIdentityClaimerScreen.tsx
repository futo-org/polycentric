import { Button, Text } from '@/src/common/components/primitives';
import {
  publicKeyToString,
  usePolycentric,
  usePolycentricContext,
} from '@/src/common/lib/polycentric-hooks';
import { Atoms, useTheme } from '@/src/common/theme';
import { PairIdentityCamera } from '@/src/features/identity-pairing/components/PairIdentityCamera';
import { usePairIdentityClaimer } from '@/src/features/identity-pairing/hooks/usePairIdentityClaimer';
import { publicKeyEmojiFingerprint } from '@/src/features/identity-pairing/publicKeyEmojiFingerprint';
import { useOnboardingLinks } from '@/src/features/onboarding/hooks/useOnboardingLinks';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { v2 } from '@polycentric/react-native';

export default function PairIdentityClaimerScreen() {
  const { theme } = useTheme();
  const client = usePolycentric();
  const { refreshCurrentIdentity } = usePolycentricContext();
  const { to } = useOnboardingLinks();

  // Error state is managed by `usePairIdentityClaimer()`, so we use `null`
  // to mean that the pairing code was invalid and couldn't be parsed and
  // `undefined` to mean that we just don't have one.
  const [pairingInfo, setPairingInfo] = useState<
    v2.PairingInfo | null | undefined
  >(undefined);

  const { error, approved, claimInProgress } =
    usePairIdentityClaimer(pairingInfo);

  const pubKeyStr = client.currentKeyPair
    ? publicKeyToString(client.currentKeyPair.publicKey)
    : '';
  const pubKeyEmoji = pubKeyStr
    ? publicKeyEmojiFingerprint(pubKeyStr).join(' ')
    : '';

  useEffect(() => {
    if (!approved) return;
    void (async () => {
      await refreshCurrentIdentity();
      // Carry the origin route through to the success screen.
      router.replace(to('/login/pair/success'));
    })();
  }, [approved, refreshCurrentIdentity, to]);

  const renderBody = () => {
    if (pairingInfo === undefined) {
      return (
        <>
          <View style={Atoms.gap_xs}>
            <Text variant="subtitle">Pair Identity</Text>
          </View>
          <PairIdentityCamera
            onCodeScanned={(info) => {
              setPairingInfo(info);
            }}
          />
        </>
      );
    }

    if (pairingInfo !== undefined && error && !claimInProgress) {
      return (
        <>
          <Text variant="title">Error</Text>
          <Text variant="body" color="negative_500">
            {error}
          </Text>
          <Button
            title="Go Back"
            variant="secondary"
            fullWidth
            onPress={() => {
              setPairingInfo(undefined);
            }}
          />
        </>
      );
    }

    return (
      <View
        style={[
          Atoms.flex_1,
          Atoms.items_center,
          Atoms.justify_center,
          Atoms.gap_xl,
        ]}
      >
        {approved ? (
          <>
            <Text variant="title" style={{ fontSize: 64, lineHeight: 96 }}>
              ✓
            </Text>
            <View style={[Atoms.items_center, Atoms.gap_xs]}>
              <Text variant="title">Approved!</Text>
              <Text
                variant="body"
                color="neutral_500"
                style={{ textAlign: 'center' }}
              >
                Completing setup...
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text
              variant="title"
              style={{
                fontSize: 84,
                // Android clips emoji when lineHeight is close to fontSize;
                // give ~1.5x headroom (cf. reaction/Emoji.tsx).
                lineHeight: 126,
                textAlign: 'center',
              }}
            >
              {pubKeyEmoji}
            </Text>

            <View style={[Atoms.items_center, Atoms.gap_sm]}>
              <Text
                variant="small"
                color="neutral_500"
                selectable
                style={{ fontFamily: 'monospace', textAlign: 'center' }}
              >
                {pubKeyStr}
              </Text>
            </View>

            <View
              style={[
                Atoms.flex_row,
                Atoms.items_center,
                Atoms.gap_sm,
                Atoms.px_md,
                Atoms.py_sm,
                Atoms.rounded_full,
                {
                  backgroundColor: theme.palette.neutral_50,
                },
              ]}
            >
              <ActivityIndicator size="small" />
              <Text variant="small" color="neutral_500">
                Waiting for approval
              </Text>
            </View>
          </>
        )}
      </View>
    );
  };

  return (
    <View
      style={[
        Atoms.flex_1,
        { backgroundColor: theme.atoms.bg.backgroundColor },
        ...(!pairingInfo || (pairingInfo && error && !claimInProgress)
          ? [Atoms.flex_col, Atoms.gap_lg]
          : []),
      ]}
    >
      {renderBody()}
    </View>
  );
}
