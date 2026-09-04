import { Text } from '@/src/common/components';
import { Routes } from '@/src/common/constants/routes';
import { useCurrentIdentity } from '@/src/common/lib/polycentric-hooks';
import { Atoms, Spacing, useTheme } from '@/src/common/theme';
import { ProfileRow } from '@/src/features/profile/ProfileRow';
import { router } from 'expo-router';
import { View } from 'react-native';
import type { DecodedClaim } from '../hooks/useClaimById';
import type { ClaimVerifier } from '../utils/claim-status';
import { PLATFORM_SCHEMA_NAME } from '../utils/platforms';
import { ClaimVerifierMenu } from './ClaimVerifierMenu';

/** Who has been asked to verify the claim, and where each of them stands. */
export function ClaimVerifiersList({
  claim,
  verifiers,
}: {
  claim: DecodedClaim;
  verifiers: ClaimVerifier[];
}) {
  const { theme } = useTheme();
  const { identityKey } = useCurrentIdentity();

  const canRemoveVerifiers =
    identityKey === claim.identity &&
    // Platform claims batch every verifier bot into one request, so single verifiers can't be cancelled there.
    claim.schemaName !== PLATFORM_SCHEMA_NAME;

  if (verifiers.length === 0) return null;

  return (
    // Break out of the claim screen's horizontal padding so the rows run
    // edge to edge; the label and row contents keep the usual inset.
    <View style={[Atoms.gap_xs, { marginHorizontal: -Spacing.lg }]}>
      <Text
        variant="small"
        fontWeight="semibold"
        style={[theme.atoms.text_neutral_medium, Atoms.px_lg]}
      >
        Verifiers
      </Text>
      <View>
        {verifiers.map((verifier) => (
          <ProfileRow
            key={verifier.identity}
            identity={verifier.identity}
            size="sm"
            onPress={() => router.push(Routes.tabs.profile(verifier.identity))}
            trailing={
              <>
                <Text
                  variant="small"
                  fontWeight="semibold"
                  color={verifier.verified ? 'positive_500' : 'neutral_500'}
                  selectable={false}
                >
                  {verifier.verified ? 'Verified' : 'Requested'}
                </Text>
                {canRemoveVerifiers && (
                  <ClaimVerifierMenu claim={claim} verifier={verifier} />
                )}
              </>
            }
          />
        ))}
      </View>
    </View>
  );
}
