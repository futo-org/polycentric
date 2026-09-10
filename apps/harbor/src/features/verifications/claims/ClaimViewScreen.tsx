import { Text } from '@/src/common/components';
import { Screen } from '@/src/common/components/layout';
import Topbar, { TOPBAR_HEIGHT } from '@/src/common/components/layout/Topbar';
import { PullRefreshControl } from '@/src/common/components/PullRefreshControl';
import { ScrollView } from '@/src/common/components/ScrollView';
import { Atoms, useTheme } from '@/src/common/theme';
import { isIOS, isWeb } from '@/src/common/util/platform';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { type ClaimField, useClaimById } from '../hooks/useClaimById';
import { useClaimVerifiers } from '../hooks/useClaimVerifiers';
import { ClaimMenu } from './ClaimMenu';
import { ClaimVerifiersList } from './ClaimVerifiersList';
import { ClaimVerifyActions } from './ClaimVerifyActions';
import { CLAIM_TYPES } from '../utils/forms';
import { getPlatformFromClaim } from '../utils/platforms';
import { resolveClaimTitle } from '../utils/render';
import { ClaimAuthorLine } from './ClaimAuthorLine';
import { ClaimTypeChip } from './toolbar/ClaimTypeChip';
import { StatusChip } from './toolbar/StatusChip';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ViewClaimScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    identityId,
    keyFingerprint,
    sequence = '',
    requestVerification,
  } = useLocalSearchParams<{
    identityId: string;
    keyFingerprint: string;
    sequence: string;
    // Set when arriving from the create flow to open the sheet immediately.
    requestVerification?: string;
  }>();

  const {
    claim,
    isLoading,
    isRefreshing: claimRefreshing,
    refresh: refreshClaim,
  } = useClaimById(
    identityId,
    keyFingerprint,
    sequence ? BigInt(sequence) : undefined,
  );

  const {
    verifiers,
    verifiedCount,
    totalCount,
    isRefreshing: verifiersRefreshing,
    refresh: refreshVerifiers,
  } = useClaimVerifiers(claim?.id, claim?.schemaName);

  const claimType = CLAIM_TYPES.find((t) => t.name === claim?.schemaName);
  // Platform claims chip as their platform (brand logo + name).
  const platform = claim
    ? getPlatformFromClaim(claim.schemaName, claim.fields)
    : undefined;

  const { title, bodyFields } = useMemo<{
    title: string;
    bodyFields: ClaimField[];
  }>(
    () =>
      claim
        ? resolveClaimTitle(claim.schemaName, claim.fields)
        : { title: '', bodyFields: [] },
    [claim],
  );

  return (
    <Screen>
      <Screen.PrimaryColumn>
        <ScrollView
          HeaderComponent={
            <Topbar
              title="Claim"
              right={claim ? <ClaimMenu claim={claim} /> : undefined}
            />
          }
          style={Atoms.flex_1}
          showsVerticalScrollIndicator={false}
          refreshControl={
            isWeb ? undefined : (
              <PullRefreshControl
                refreshing={claimRefreshing || verifiersRefreshing}
                onRefresh={() => {
                  refreshClaim();
                  refreshVerifiers();
                }}
              />
            )
          }
          contentContainerStyle={[
            Atoms.flex_grow_1,
            // iOS's sliding header overhangs the scroll view by the topbar
            // height; pad it back so the bottom actions start on screen.
            { paddingBottom: insets.bottom + (isIOS ? TOPBAR_HEIGHT : 0) },
          ]}
        >
          <View style={[Atoms.p_lg, Atoms.gap_lg, Atoms.flex_grow_1]}>
            {isLoading && !claim && (
              <View style={[Atoms.items_center, Atoms.mt_lg]}>
                <ActivityIndicator />
              </View>
            )}

            {!isLoading && !claim && (
              <Text variant="body" style={theme.atoms.text}>
                Invalid claim reference
              </Text>
            )}

            {claim && (
              <>
                <ClaimAuthorLine
                  identity={claim.identity}
                  createdAt={claim.createdAt}
                  avatarSize="md"
                />

                <View
                  style={[
                    Atoms.flex_row,
                    Atoms.align_center,
                    Atoms.gap_md,
                    Atoms.justify_between,
                    Atoms.flex_wrap,
                  ]}
                >
                  <Text
                    variant="body"
                    style={[theme.atoms.text, Atoms.flex_shrink_1]}
                  >
                    {title}
                  </Text>
                </View>
                <View
                  style={[Atoms.flex_row, Atoms.align_center, Atoms.gap_sm]}
                >
                  <ClaimTypeChip
                    name={platform?.name ?? claim.schemaName}
                    icon={claimType?.icon ?? 'verify'}
                    logo={platform?.logo}
                    color={platform?.color ?? claimType?.color}
                  />
                  {/* Verified status */}
                  <StatusChip
                    verifiedCount={verifiedCount}
                    totalCount={totalCount}
                  />
                </View>

                <View style={Atoms.gap_lg}>
                  {bodyFields.map((field) => {
                    const value = field.value.trim();
                    // URL values (e.g. a Platform claim's profile URL) open
                    // the linked account.
                    const isLink = /^https?:\/\//i.test(value);
                    return (
                      <View key={field.key} style={Atoms.gap_xs}>
                        <Text
                          variant="small"
                          style={theme.atoms.text_neutral_medium}
                          fontWeight="semibold"
                        >
                          {field.label}
                        </Text>
                        {isLink ? (
                          <Text
                            variant="body"
                            color="primary_500"
                            onPress={() =>
                              void Linking.openURL(value).catch(() => {})
                            }
                          >
                            {value}
                          </Text>
                        ) : (
                          <Text
                            variant="body"
                            style={
                              value
                                ? theme.atoms.text
                                : theme.atoms.text_neutral_medium
                            }
                          >
                            {value || 'N/A'}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>

                <ClaimVerifiersList claim={claim} verifiers={verifiers} />

                <View style={[Atoms.flex_1]} />
                <ClaimVerifyActions
                  claim={claim}
                  verifiers={verifiers}
                  requestOnOpen={requestVerification === '1'}
                />
              </>
            )}
          </View>
        </ScrollView>
      </Screen.PrimaryColumn>
    </Screen>
  );
}
