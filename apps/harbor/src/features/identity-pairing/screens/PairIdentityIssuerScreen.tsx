import { Button, Screen, ScreenHeader, Text } from '@/src/common/components';
import Icon from '@/src/common/components/Icon';
import { Sheet } from '@/src/common/components/sheet';
import { Atoms, useTheme } from '@/src/common/theme';
import { usePairIdentityIssuer } from '@/src/features/identity-pairing/hooks/usePairIdentityIssuer';
import { publicKeyEmojiFingerprint } from '@/src/features/identity-pairing/publicKeyEmojiFingerprint';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { encodePairingCode, EncodingMode } from '../pairingCode';
import { useCountdown } from '../hooks/useCountdown';
import type { v2 } from '@polycentric/react-native';

/** Width of the UI elements in the pairing info card. */
const PAIRING_BLOCK_WIDTH = 300;

export default function PairIdentityIssuerScreen() {
  const { theme } = useTheme();

  const { info, expiresAt, claimers, error, stage, approveClaimer } =
    usePairIdentityIssuer();

  const { remainingSeconds, expired } = useCountdown(expiresAt);

  /**
   * The index into the claimers array to display to the user.
   * May be out of bounds if we have no pending claimers.
   */
  const [claimerCursor, setClaimerCursor] = useState<number>(0);

  /** Reject the currently-displayed claimer. */
  const rejectClaimer = () => {
    setClaimerCursor((count) => (count === claimerCursor ? count + 1 : count));
  };

  // TODO: it would be nice to have a success status page for 'done'
  // and an error status page for `expired`.
  useEffect(() => {
    if (stage === 'done' || expired) {
      router.back();
    }
  }, [stage, expired]);

  let pendingClaimer: string | null = null;

  if ((stage === 'polling' || stage === 'approving') && !expired) {
    pendingClaimer = claimers.at(claimerCursor) ?? null;
  }

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
                <PairingInfoCard
                  info={info}
                  remainingSeconds={remainingSeconds}
                />
              )}
            </ScrollView>
          </View>
        </Screen.PrimaryColumn>
      </Screen>

      <ApprovalSheet
        claimer={pendingClaimer}
        currentlyApproving={stage === 'approving'}
        onAccept={approveClaimer}
        onDeny={rejectClaimer}
      />
    </>
  );
}

function PairingInfoCard({
  info,
  remainingSeconds,
}: {
  info: v2.PairingInfo | null;
  remainingSeconds: number | null;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        Atoms.gap_md,
        Atoms.p_lg,
        Atoms.rounded_lg,
        { backgroundColor: theme.palette.neutral_50 },
      ]}
    >
      <PairingQRCode info={info} />
      <CopyButton info={info} />
      <View style={Atoms.items_center}>
        <CountdownTimer remainingSeconds={remainingSeconds} />
      </View>
    </View>
  );
}

function PairingQRCode({ info }: { info: v2.PairingInfo | null }) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        Atoms.items_center,
        Atoms.justify_center,
        Atoms.rounded_lg,
        Atoms.overflow_hidden,
        {
          backgroundColor: theme.palette.white,
        },
      ]}
    >
      {info ? (
        <QRCode
          value={encodePairingCode(info, EncodingMode.BASE64)}
          size={PAIRING_BLOCK_WIDTH}
          color={theme.palette.black}
          backgroundColor={theme.palette.white}
          quietZone={32}
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
  );
}

function CountdownTimer({
  remainingSeconds,
}: {
  remainingSeconds: number | null;
}) {
  const { theme } = useTheme();

  let timeStr = '--:--';

  if (remainingSeconds !== null) {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

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
          {timeStr}
        </Text>
      </Text>
    </View>
  );
}

function CopyButton({ info }: { info: v2.PairingInfo | null }) {
  const { theme } = useTheme();

  /** When true, indicate to the user that the text was copied. */
  const [justCopied, setJustCopied] = useState<boolean>(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doCopy = useCallback(() => {
    if (!info) {
      return;
    }

    const code = encodePairingCode(info, EncodingMode.HEX);
    void Clipboard.setStringAsync(code);

    setJustCopied(true);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setJustCopied(false);
      timeoutRef.current = null;
    }, 2000);
  }, [info]);

  return (
    <Pressable
      onPress={doCopy}
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
      <Text variant="small" color="primary_500" fontWeight="semibold">
        {justCopied ? 'Copied' : 'Copy pairing code'}
      </Text>
    </Pressable>
  );
}

/** Render the approval sheet and show it if `claimer` is non-null. */
function ApprovalSheet({
  claimer,
  currentlyApproving,
  onAccept,
  onDeny,
}: {
  claimer: string | null;
  currentlyApproving: boolean;
  onAccept: (claimer: string, asRotation: boolean) => void;
  onDeny: () => void;
}) {
  const { theme } = useTheme();
  const [asRotation, setAsRotation] = useState<boolean>(true);

  const approveClaimer = useCallback(() => {
    if (!claimer) return;
    onAccept(claimer, asRotation);
  }, [onAccept, claimer, asRotation]);

  // We want to keep displaying the last shown claimer while the sheet is dismissing.
  // To do this, we keep `displayClaimer` up to date unless `claimer` switches to null.
  const [displayClaimer, setDisplayClaimer] = useState<string | null>(null);
  if (claimer && claimer !== displayClaimer) {
    setDisplayClaimer(claimer);
  }

  const showSheet = !!claimer;
  const renderContent = !!displayClaimer;

  return (
    <Sheet
      open={showSheet}
      detents={[0.6, 1]}
      dismissible={false}
      onClose={onDeny}
    >
      <Sheet.Header
        title="Pending Approval"
        onClose={onDeny}
        disabled={currentlyApproving}
      />
      <Sheet.Content
        style={[Atoms.px_lg, Atoms.pt_2xl, Atoms.pb_lg, Atoms.gap_lg]}
      >
        {renderContent ? (
          <>
            <View style={[Atoms.items_center, Atoms.gap_md]}>
              <Text variant="title" style={{ fontSize: 64, lineHeight: 72 }}>
                {publicKeyEmojiFingerprint(displayClaimer).join(' ')}
              </Text>
              <Text
                variant="small"
                color="neutral_500"
                style={{ fontFamily: 'monospace', textAlign: 'center' }}
                selectable
              >
                {displayClaimer}
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
              {currentlyApproving ? (
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
                  onPress={approveClaimer}
                />
              )}
              <Button
                title="Deny"
                variant="secondary"
                size="md"
                onPress={onDeny}
                disabled={currentlyApproving}
              />
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: asRotation }}
              onPress={() => setAsRotation(!asRotation)}
              disabled={currentlyApproving}
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
                  borderColor: asRotation
                    ? theme.palette.primary_500
                    : theme.palette.neutral_300,
                  backgroundColor: asRotation
                    ? theme.palette.primary_500
                    : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 1,
                }}
              >
                {asRotation ? (
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
          </>
        ) : null}
      </Sheet.Content>
    </Sheet>
  );
}
