import { Button, Screen, ScreenHeader, Text } from '@/src/common/components';
import Icon from '@/src/common/components/Icon';
import { showAlert } from '@/src/common/lib/dialogs';
import { usePolycentric } from '@/src/common/lib/polycentric-hooks';
import { useCurrentAuthorization } from '@/src/common/lib/polycentric-hooks/useCurrentAuthorization';
import { Atoms, Spacing, useTheme } from '@/src/common/theme';
import {
  assembleIdentityBackup,
  backupFileName,
  encodeIdentityBackup,
} from '@/src/features/identity-backup/backup';
import { BackupStatus } from '@/src/features/identity-backup/components/BackupStatus';
import { saveBackupFile } from '@/src/features/identity-backup/saveBackupFile';
import {
  SyncStrategy,
  type PolycentricClient,
} from '@polycentric/react-native';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type NewBackupState =
  | { stage: 'warning' }
  | { stage: 'creating' }
  | {
      stage: 'ready';
      backupData: string;
      fileName: string;
      saveAttempted: boolean;
    }
  | { stage: 'failed'; message: string };

/**
 * Rotate the identity's recovery key and prepare a backup for export.
 */
async function createNewBackup(client: PolycentricClient) {
  const identity = client.activeIdentityKey;
  const myPublicKey = client.currentKeyPair?.publicKey;
  if (!identity || !myPublicKey)
    throw new Error('Must be signed in to create a backup');

  await client.sync(SyncStrategy.PARTIAL_PULL);

  const privateKey = await client.identityManager.rotateRecoveryKey();
  const backup = assembleIdentityBackup(client, privateKey);

  return {
    backupData: encodeIdentityBackup(backup),
    fileName: backupFileName(backup),
  };
}

export default function CreateBackupScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const { canRotate } = useCurrentAuthorization();
  const [state, setState] = useState<NewBackupState>(() => {
    if (!canRotate) {
      return {
        stage: 'failed',
        message: 'Only rotation keys can create backups',
      };
    }

    return { stage: 'warning' };
  });

  const client = usePolycentric();
  const [hadExisting] = useState(
    () => !!client.identityManager.resolveIdentity()?.recoveryKey,
  );

  const onContinue = () => {
    switch (state.stage) {
      case 'warning':
        setState({ stage: 'creating' });

        void (async () => {
          try {
            const newBackup = await createNewBackup(client);
            setState({
              stage: 'ready',
              saveAttempted: false,
              ...newBackup,
            });
          } catch (err: unknown) {
            console.warn('Failed to create a new backup:', err);
            setState({
              stage: 'failed',
              message:
                'An error was encountered while creating the backup file.',
            });
          }
        })();
        return;

      case 'creating':
        return;

      case 'ready':
      case 'failed':
        router.back();
        return;
    }
  };

  const onSave = () => {
    if (state.stage !== 'ready') return;
    const { backupData, fileName } = state;

    setState((prev) =>
      prev.stage === 'ready' ? { ...prev, saveAttempted: true } : prev,
    );

    (async () => {
      try {
        await saveBackupFile(fileName, backupData);
      } catch (err: unknown) {
        console.warn('Failed to save the backup file:', err);
        showAlert({
          title: 'Could not save the file',
          message: 'Your backup file could not be saved. Please try again.',
        });
      }
    })();
  };

  const continueTitle = (() => {
    switch (state.stage) {
      case 'warning':
        return 'Continue';
      case 'creating':
        return 'Creating backup...';
      case 'ready':
      case 'failed':
        return 'Done';
    }
  })();

  const continueDisabled =
    state.stage === 'creating' ||
    (state.stage === 'ready' && !state.saveAttempted);

  const continueHint =
    state.stage === 'ready' ? (
      <Text variant="body" color="neutral_500">
        Press this once you have finished securely saving the backup file:
      </Text>
    ) : undefined;

  let innerContent: ReactNode = null;
  if (state.stage === 'ready') {
    innerContent = <BackupContent onSave={onSave} />;
  } else if (state.stage === 'failed') {
    innerContent = <BackupStatus successful={false} message={state.message} />;
  }

  return (
    <Screen>
      <Screen.PrimaryColumn>
        <View
          style={[
            Atoms.px_lg,
            Atoms.flex_1,
            Atoms.gap_md,
            { backgroundColor: theme.atoms.bg.backgroundColor },
          ]}
        >
          <ScreenHeader
            title="Back Up Identity"
            onBack={state.stage === 'warning' ? () => router.back() : undefined}
          />

          <ScrollView
            // Fit the scrollview to the parent
            style={Atoms.flex_1}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              Atoms.gap_md,
              { paddingBottom: insets.bottom + Spacing['4xl'] },
            ]}
          >
            <View style={Atoms.gap_sm}>
              <BackupInfo stage={state.stage} hasExisting={hadExisting} />
            </View>

            {innerContent}

            <View style={[Atoms.gap_sm, Atoms.mt_sm]}>
              {continueHint}
              <Button
                title={continueTitle}
                variant="tertiary"
                fullWidth
                disabled={continueDisabled}
                onPress={onContinue}
              />
            </View>
          </ScrollView>
        </View>
      </Screen.PrimaryColumn>
    </Screen>
  );
}

/**
 * Displays helpful info relating to the current backup stage.
 */
function BackupInfo({
  stage,
  hasExisting,
}: {
  stage: NewBackupState['stage'];
  hasExisting: boolean;
}) {
  const { theme } = useTheme();

  switch (stage) {
    case 'warning':
      return (
        <>
          <Text variant="title">Before you continue</Text>
          <Text variant="body" color="neutral_500">
            Your identity backup is a file that can restore your Harbor identity
            even if you are logged out on all of your devices.
          </Text>
          <View
            style={[
              Atoms.p_md,
              Atoms.rounded_lg,
              Atoms.my_xs,
              {
                backgroundColor: theme.palette.negative_25,
                borderWidth: 1,
                borderColor: theme.palette.negative_100,
              },
            ]}
          >
            <Text variant="secondary" color="negative_500">
              The backup cannot be fully deactivated once it is created. Be
              absolutely sure to store it securely so that it will never leak or
              be discovered by anyone else.
            </Text>
          </View>
          <Text variant="body" color="neutral_500">
            The next screen creates a new backup and lets you export it from
            Harbor as a file. Prepare a private and secure way to store it
            before you go on.
          </Text>

          {hasExisting ? (
            <Text variant="secondary" color="warning_500">
              You already have an existing backup. Do not continue unless you
              have lost access to it.
            </Text>
          ) : undefined}
        </>
      );

    case 'creating':
      return (
        <>
          <Text variant="title">Creating your backup</Text>
          <Text variant="body" color="neutral_500">
            Generating and registering a new backup...
          </Text>
        </>
      );

    case 'ready':
      return (
        <>
          <Text variant="title">Save your backup file</Text>
          <Text variant="body" color="neutral_500">
            The backup file can be used to restore your Harbor identity if you
            are ever logged out on all of your devices. Remember to store it
            somewhere safe and private. To use the backup file, press "I already
            have an identity" and then "Recover using backup" when logging in on
            a new device.
          </Text>

          {hasExisting ? (
            <Text variant="secondary" color="warning_500">
              The backup file below is now the active one. Save this instead of
              any older backup, but still do not share your old backup file with
              anyone.
            </Text>
          ) : undefined}
        </>
      );

    case 'failed':
      return null;
  }
}

/**
 * Exposes the backup file to the user.
 */
function BackupContent({ onSave }: { onSave: () => void }) {
  return (
    <View style={[Atoms.gap_sm, Atoms.my_3xl]}>
      <Text variant="body" color="neutral_500">
        Save this file somewhere safe:
      </Text>
      <Button
        title="Save backup file"
        variant="primary"
        fullWidth
        icon={({ size, color }) => (
          <Icon name="download" size={size} color={color} />
        )}
        onPress={onSave}
      />
    </View>
  );
}
