import { Button, Screen, ScreenHeader, Text } from '@/src/common/components';
import Icon from '@/src/common/components/Icon';
import { Sheet } from '@/src/common/components/sheet';
import { Atoms, useTheme } from '@/src/common/theme';
import { usePairIdentityIssuer } from '@/src/features/identity-pairing/hooks/usePairIdentityIssuer';
import { publicKeyEmojiFingerprint } from '@/src/features/identity-pairing/publicKeyEmojiFingerprint';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { encodePairingCode, EncodingMode } from '../pairingCode';

const PAIRING_BLOCK_WIDTH = 300;

function CountdownTimer({
  expiresAt,
  onExpire,
}: {
  expiresAt: Date | null;
  onExpire?: () => void;
}) {
  const { theme } = useTheme();
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }

    const expiresAtMs = expiresAt.getTime();
    const updateRemaining = () => {
      const nextRemaining = Math.max(
        0,
        Math.floor((expiresAtMs - Date.now()) / 1000),
      );
      setRemaining(nextRemaining);

      if (nextRemaining === 0) {
        onExpire?.();
        return true;
      }

      return false;
    };

    if (updateRemaining()) {
      return;
    }

    const interval = setInterval(() => {
      if (updateRemaining()) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <View style={[Atoms.flex_row, Atoms.items_center, Atoms.gap_sm]}>
      <Icon name="time" size={16} color="neutral_500" />
      <Text variant="small" color="neutral_500">
        Valid for{'  '}
        <Text
          variant="small"
          style={{
            fontFamily: 'monospace',
            color: theme.palette.primary_500,
          }}
        >
          {expiresAt ? timeStr : '--:--'}
        </Text>
      </Text>
    </View>
  );
}

export default function PairIdentityIssuerScreen() {
  const { theme } = useTheme();
  const { info, expiresAt, claimers, error, stage, approveClaimer } =
    usePairIdentityIssuer();

  /** Show an indicator that the pairing code has been copied when true. */
  const [justCopied, setJustCopied] = useState(false);

  /** Pair as a rotation key instead of just a signing key when true. */
  const [pairAsRotationKey, setPairAsRotationKey] = useState(true);

  /** The prefix of the claimers array that we have rejected. */
  const [rejectedCount, setRejectedCount] = useState(0);

  /** Reject the currently-displayed claimer. */
  const rejectClaimer = () => {
    setRejectedCount((count) => (count === rejectedCount ? count + 1 : count));
  };

  useEffect(() => {
    if (stage === 'done') {
      router.back();
    }
  }, [stage]);

  const onExpire = () => {
    // TODO: surface as error or something instead.
    router.back();
  };

  const showApprovalSheet = claimers.length > rejectedCount;

  const renderPendingApprovalsSheet = () => {
    const claimerStr = claimers[rejectedCount];

    return (
      <Sheet
        open={!!claimerStr}
        detents={[0.6, 1]}
        dismissible
        onClose={rejectClaimer}
      >
        {(() => {
          function PendingApprovalsSheetBody() {
            const { theme } = useTheme();
            const isApproving = stage === 'approving';

            return (
              <>
                <Sheet.Header
                  title="Pending Approvals"
                  onClose={rejectClaimer}
                />
                <Sheet.Content
                  style={[Atoms.px_lg, Atoms.pt_2xl, Atoms.pb_lg, Atoms.gap_lg]}
                >
                  <View style={[Atoms.items_center, Atoms.gap_md]}>
                    <Text
                      variant="title"
                      // Android clips emoji when lineHeight is close to
                      // fontSize; give ~1.5x headroom (cf. reaction/Emoji.tsx).
                      style={{ fontSize: 64, lineHeight: 96 }}
                    >
                      {publicKeyEmojiFingerprint(claimerStr).join(' ')}
                    </Text>
                    <Text
                      variant="small"
                      color="neutral_500"
                      style={{ fontFamily: 'monospace', textAlign: 'center' }}
                      selectable
                    >
                      {claimerStr}
                    </Text>
                  </View>

                  <View
                    style={[
                      Atoms.flex_row,
                      Atoms.gap_sm,
                      Atoms.justify_center,
                      Atoms.items_center,
                    ]}
                  >
                    {isApproving ? (
                      <View
                        style={[
                          Atoms.items_center,
                          Atoms.justify_center,
                          Atoms.py_md,
                        ]}
                      >
                        <ActivityIndicator size="small" />
                      </View>
                    ) : (
                      <Button
                        title="Approve"
                        variant="primary"
                        size="md"
                        onPress={() => {
                          approveClaimer(claimerStr, pairAsRotationKey);
                        }}
                      />
                    )}
                    <Button
                      title="Deny"
                      variant="secondary"
                      size="md"
                      onPress={rejectClaimer}
                    />
                  </View>

                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: pairAsRotationKey }}
                    onPress={() => setPairAsRotationKey(!pairAsRotationKey)}
                    style={[
                      Atoms.flex_row,
                      Atoms.items_start,
                      Atoms.gap_md,
                      Atoms.p_md,
                      Atoms.rounded_md,
                      {
                        backgroundColor: theme.palette.neutral_50,
                        borderWidth: 1,
                        borderColor: theme.palette.neutral_200,
                      },
                    ]}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        borderWidth: 1.5,
                        borderColor: pairAsRotationKey
                          ? theme.palette.primary_500
                          : theme.palette.neutral_300,
                        backgroundColor: pairAsRotationKey
                          ? theme.palette.primary_500
                          : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      {pairAsRotationKey ? (
                        <Icon name="checkmark" size={14} color="neutral_0" />
                      ) : null}
                    </View>
                    <View style={[Atoms.flex_1, Atoms.gap_xs]}>
                      <Text variant="small" fontWeight="semibold">
                        Add as rotation key
                      </Text>
                      <Text variant="small" color="neutral_500">
                        Gives this device management access.
                      </Text>
                    </View>
                  </Pressable>
                </Sheet.Content>
              </>
            );
          }

          return <PendingApprovalsSheetBody />;
        })()}
      </Sheet>
    );
  };

  return (
    <>
      <Screen>
        <Screen.PrimaryColumn>
          <View
            style={[
              Atoms.px_lg,
              Atoms.flex_1,
              { backgroundColor: theme.atoms.bg.backgroundColor },
            ]}
          >
            <ScreenHeader title="Pair Identity" onBack={() => router.back()} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                Atoms.gap_lg,
                Atoms.pb_lg,
                Atoms.items_center,
                { paddingTop: 100 },
              ]}
            >
              {error ? (
                <Text variant="body" color="negative_500">
                  {error}
                </Text>
              ) : (
                <View style={Atoms.gap_md}>
                  <View
                    style={[
                      Atoms.items_center,
                      Atoms.justify_center,
                      Atoms.p_xl,
                      Atoms.rounded_lg,
                      {
                        backgroundColor: theme.palette.neutral_50,
                      },
                    ]}
                  >
                    {info ? (
                      <QRCode
                        value={encodePairingCode(info, EncodingMode.BASE64)}
                        size={PAIRING_BLOCK_WIDTH}
                        color={theme.palette.neutral_950}
                        backgroundColor="transparent"
                      />
                    ) : (
                      <View
                        style={{
                          width: PAIRING_BLOCK_WIDTH,
                          height: PAIRING_BLOCK_WIDTH,
                        }}
                      />
                    )}
                  </View>

                  <Pressable
                    onPress={() => {
                      if (!info) {
                        return;
                      }

                      const code = encodePairingCode(info, EncodingMode.HEX);
                      void Clipboard.setStringAsync(code);
                      setJustCopied(true);
                      setTimeout(() => setJustCopied(false), 2000);
                    }}
                    disabled={!info}
                    style={({ hovered }) => [
                      Atoms.flex_row,
                      Atoms.items_center,
                      Atoms.justify_center,
                      Atoms.gap_sm,
                      Atoms.py_md,
                      Atoms.rounded_full,
                      {
                        backgroundColor: hovered
                          ? theme.palette.primary_100
                          : theme.palette.primary_50,
                      },
                    ]}
                  >
                    <Icon
                      name={justCopied ? 'checkmark' : 'copy'}
                      size={16}
                      color="primary_500"
                    />
                    <Text
                      variant="small"
                      color="primary_500"
                      fontWeight="semibold"
                    >
                      {justCopied ? 'Copied' : 'Copy pairing code'}
                    </Text>
                  </Pressable>

                  <View style={Atoms.items_center}>
                    <CountdownTimer expiresAt={expiresAt} onExpire={onExpire} />
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </Screen.PrimaryColumn>
      </Screen>

      {showApprovalSheet ? renderPendingApprovalsSheet() : null}
    </>
  );
}
