import { Button, Screen, ScreenHeader, Text } from '@/src/common/components';
import Icon from '@/src/common/components/Icon';
import { Sheet } from '@/src/common/components/sheet';
import { useCurrentIdentity } from '@/src/common/lib/polycentric-hooks';
import { Atoms, useTheme } from '@/src/common/theme';
import { usePairIdentityIssuer } from '@/src/features/identity-pairing/hooks/usePairIdentityIssuer';
import { publicKeyEmojiFingerprint } from '@/src/features/identity-pairing/publicKeyEmojiFingerprint';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { encodePairingCode } from '../pairingCode';
import { bytesToHex } from '@polycentric/react-native';

const PAIRING_BLOCK_WIDTH = 200;

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
  const { identityKey } = useCurrentIdentity();
  const {
    currentPairingSession,
    pendingClaimers,
    createPairingSession,
    pairingSessionError,
    pairingSessionLoading,
    clearPairingSession,
    denyClaimer,
    approveClaimer,
  } = usePairIdentityIssuer(identityKey);
  const [justCopied, setJustCopied] = useState(false);
  const [approvingClaimers, setApprovingClaimers] = useState<Set<string>>(
    new Set(),
  );
  const [pairAsRotationKey, setPairAsRotationKey] = useState(true);
  const [showPendingApprovals, setShowPendingApprovals] = useState(false);
  const [activePendingClaimer, setActivePendingClaimer] = useState<
    string | null
  >(null);

  const pairingCode = currentPairingSession
    ? encodePairingCode({
        origin: currentPairingSession.server,
        code: currentPairingSession.code,
        identity: currentPairingSession.identityKey,
      })
    : undefined;

  useEffect(() => {
    return () => {
      clearPairingSession();
    };
  }, [clearPairingSession]);

  useEffect(() => {
    if (
      identityKey &&
      !currentPairingSession &&
      !pairingSessionError &&
      !pairingSessionLoading
    ) {
      void createPairingSession();
    }
  }, [
    identityKey,
    currentPairingSession,
    createPairingSession,
    pairingSessionError,
    pairingSessionLoading,
  ]);

  useEffect(() => {
    const next = pendingClaimers.length;
    const nextClaimer = pendingClaimers[0] ?? null;

    if (next > 0 && nextClaimer !== activePendingClaimer) {
      setActivePendingClaimer(nextClaimer);
    }

    if (next > 0 && !showPendingApprovals && nextClaimer) {
      setShowPendingApprovals(true);
    }
  }, [
    pendingClaimers,
    pendingClaimers.length,
    showPendingApprovals,
    activePendingClaimer,
  ]);

  const handleExpire = () => {
    if (currentPairingSession) {
      clearPairingSession();
    }
    router.back();
  };

  const renderPendingApprovalsSheet = () => {
    const claimerStr = activePendingClaimer;
    const activeClaimer = claimerStr ?? '';

    const closeAndDeny = () => {
      if (activeClaimer) denyClaimer(activeClaimer);
      setActivePendingClaimer(null);
      setShowPendingApprovals(false);
    };

    const closeSilently = () => {
      setActivePendingClaimer(null);
      setShowPendingApprovals(false);
    };

    return (
      <Sheet
        open={!!claimerStr}
        detents={[0.6, 1]}
        dismissible
        onClose={closeAndDeny}
      >
        {(() => {
          function PendingApprovalsSheetBody() {
            const { theme } = useTheme();
            const dismissRequestedRef = useRef(false);
            const [isApproveActionActive, setIsApproveActionActive] =
              useState(false);
            const isApproving = approvingClaimers.has(activeClaimer);
            const pendingCount = pendingClaimers.length;

            // biome-ignore lint/correctness/useExhaustiveDependencies: biome can't track captures of components declared inside callbacks
            useEffect(() => {
              if (pendingCount > 0 || isApproving || isApproveActionActive) {
                dismissRequestedRef.current = false;
                return;
              }

              if (dismissRequestedRef.current) return;
              dismissRequestedRef.current = true;
              closeSilently();
            }, [pendingCount, isApproving, isApproveActionActive]);

            return (
              <>
                <Sheet.Header
                  title="Pending Approvals"
                  onClose={closeAndDeny}
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
                      {publicKeyEmojiFingerprint(activeClaimer).join(' ')}
                    </Text>
                    <Text
                      variant="small"
                      color="neutral_500"
                      style={{ fontFamily: 'monospace', textAlign: 'center' }}
                      selectable
                    >
                      {activeClaimer}
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
                        onPress={async () => {
                          setIsApproveActionActive(true);
                          try {
                            const claimerToApprove = activeClaimer;
                            if (!identityKey || !claimerToApprove) {
                              return;
                            }

                            setApprovingClaimers(
                              (prev) => new Set([...prev, claimerToApprove]),
                            );
                            try {
                              await approveClaimer(
                                claimerToApprove,
                                pairAsRotationKey,
                              );
                              router.back();
                            } catch (err) {
                              console.error('approve failed:', err);
                            } finally {
                              setApprovingClaimers((prev) => {
                                const next = new Set(prev);
                                next.delete(claimerToApprove);
                                return next;
                              });
                            }
                          } finally {
                            setIsApproveActionActive(false);
                          }
                        }}
                      />
                    )}
                    <Button
                      title="Deny"
                      variant="secondary"
                      size="md"
                      onPress={() => {
                        denyClaimer(activeClaimer);
                      }}
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
              {pairingSessionError ? (
                <Text variant="body" color="negative_500">
                  {pairingSessionError}
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
                    {pairingCode ? (
                      <QRCode
                        value={pairingCode}
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
                      if (!pairingCode) {
                        return;
                      }

                      // Encode the pairing code to hex rather than exposing the
                      // raw JSON string to the user.
                      const pairingCodeBytes = new TextEncoder().encode(
                        pairingCode,
                      );
                      const hexPairingCode = bytesToHex(pairingCodeBytes);

                      void Clipboard.setStringAsync(hexPairingCode);
                      setJustCopied(true);
                      setTimeout(() => setJustCopied(false), 2000);
                    }}
                    disabled={pairingSessionLoading || !pairingCode}
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
                    <CountdownTimer
                      expiresAt={currentPairingSession?.expiresAt ?? null}
                      onExpire={handleExpire}
                    />
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </Screen.PrimaryColumn>
      </Screen>

      {showPendingApprovals ? renderPendingApprovalsSheet() : null}
    </>
  );
}
