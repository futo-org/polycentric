import { Button, Text } from '@/src/common/components';
import {
  usePolycentric,
  usePolycentricContext,
} from '@/src/common/lib/polycentric-hooks';
import { Atoms } from '@/src/common/theme';
import {
  decodeIdentityBackup,
  isStaleBackup,
} from '@/src/features/identity-backup/backup';
import {
  BackupFilePicker,
  type PickedBackupFile,
} from '@/src/features/identity-backup/components/BackupFilePicker';
import { BackupStatus } from '@/src/features/identity-backup/components/BackupStatus';
import { useOnboardingLinks } from '@/src/features/onboarding/hooks/useOnboardingLinks';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';

/** State for the current stage in the recovery flow */
type RecoverState =
  | { stage: 'input' }
  | { stage: 'recovering' }
  | { stage: 'failure'; message?: string };

/**
 * Sign in to an identity using a backup file.
 */
export default function RecoverIdentityScreen() {
  const client = usePolycentric();
  const { refreshCurrentIdentity } = usePolycentricContext();
  const { to } = useOnboardingLinks();

  const [state, setState] = useState<RecoverState>({ stage: 'input' });
  const stage = state.stage;

  const [picked, setPicked] = useState<PickedBackupFile>();

  const onPress = async () => {
    if (stage === 'failure') return setState({ stage: 'input' });
    if (stage !== 'input' || !picked) return;

    setState({ stage: 'recovering' });

    const backup = decodeIdentityBackup(picked.contents);
    if (!backup) {
      console.warn('Recovery failed: unable to decode backup file');
      setState({ stage: 'failure' });
      return;
    }

    try {
      await client.identityManager.recoverIdentity(backup);
    } catch (err: unknown) {
      console.warn('Recovery failed:', err);

      const message = isStaleBackup(client, backup)
        ? 'Recovery failed because the backup file is outdated.'
        : undefined;

      setState({ stage: 'failure', message });
      return;
    }

    await refreshCurrentIdentity();
    router.replace(to('/login/recover/success'));
  };

  let buttonTitle: string;
  if (stage === 'input') buttonTitle = 'Recover';
  else if (stage === 'recovering') buttonTitle = 'Recovering…';
  else buttonTitle = 'Try again';

  const buttonDisabled =
    stage === 'recovering' || (stage === 'input' && !picked);

  let innerContent: ReactNode;
  if (stage === 'failure') {
    const message =
      state.message ?? 'Unable to recover identity from this backup file.';

    innerContent = <BackupStatus successful={false} message={message} />;
  } else {
    innerContent = (
      <>
        <Text variant="title">Recover using backup</Text>
        <Text variant="body" color="neutral_500">
          Recover your identity using a backup file exported from Harbor. Use
          this only if none of your devices are logged in to Harbor. Otherwise,
          use the pairing feature instead.
        </Text>
        <BackupFilePicker
          picked={picked}
          disabled={stage !== 'input'}
          onPicked={setPicked}
        />
      </>
    );
  }

  return (
    <View style={[Atoms.flex_col, Atoms.flex_1, Atoms.gap_lg]}>
      {innerContent}
      <Button
        title={buttonTitle}
        variant="primary"
        fullWidth
        disabled={buttonDisabled}
        onPress={() => void onPress()}
      />
    </View>
  );
}
