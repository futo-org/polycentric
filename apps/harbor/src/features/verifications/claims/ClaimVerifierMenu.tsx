import { Text } from '@/src/common/components';
import DropdownMenu from '@/src/common/components/DropdownMenu';
import Icon from '@/src/common/components/Icon';
import { useToast } from '@/src/common/components/toast';
import { confirm } from '@/src/common/lib/dialogs/alert';
import { Atoms, useTheme, withHexOpacity } from '@/src/common/theme';
import { View } from 'react-native';
import type { DecodedClaim } from '../hooks/useClaimById';
import useRemoveVerifier from '../hooks/useRemoveVerifier';
import type { ClaimVerifier } from '../utils/claim-status';

export function ClaimVerifierMenu({
  claim,
  verifier,
}: {
  claim: DecodedClaim;
  verifier: ClaimVerifier;
}) {
  const { theme } = useTheme();
  const toast = useToast();
  const removeVerifier = useRemoveVerifier(claim);

  const onRemovePress = async () => {
    const ok = await confirm(
      verifier.verified
        ? {
            title: 'Remove verifier?',
            message: 'Their verification will no longer count for this claim.',
            confirmText: 'Remove',
            cancelText: 'Keep',
          }
        : {
            title: 'Cancel request?',
            message: 'They will no longer be asked to verify this claim.',
            confirmText: 'Cancel request',
            cancelText: 'Keep',
          },
    );
    if (!ok) return;
    try {
      await removeVerifier.submit(verifier.identity);
      toast.success(
        verifier.verified
          ? 'Verifier removed'
          : 'Verification request cancelled',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger hitSlop={16} style={Atoms.outline_none}>
        {({ pressed, hovered }) => (
          <View
            style={[
              Atoms.p_xs,
              Atoms.rounded_full,
              Atoms.overflow_hidden,
              (hovered || pressed) && {
                backgroundColor: withHexOpacity(
                  theme.palette.neutral_500,
                  '14',
                ),
              },
            ]}
          >
            <Icon name="more" color="neutral_500" size={20} />
          </View>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item
          disabled={removeVerifier.isPending}
          onPress={onRemovePress}
        >
          {verifier.verified ? (
            <>
              <Icon name="personRemove" color="negative_500" size={16} />
              <Text variant="secondary" fontWeight="bold" color="negative_500">
                Remove verifier
              </Text>
            </>
          ) : (
            <>
              <Icon name="close" color="neutral_500" size={16} />
              <Text variant="secondary" fontWeight="bold" color="neutral_500">
                Cancel request
              </Text>
            </>
          )}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
