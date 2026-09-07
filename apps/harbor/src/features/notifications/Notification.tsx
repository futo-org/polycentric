import { Text } from '@/src/common/components';
import { ProfileAvatar } from '@/src/common/components/Avatar/ProfileAvatar';
import { Routes } from '@/src/common/constants';
import { timeAgo, type PostData } from '@/src/common/lib/polycentric-hooks';
import { getKeyFingerprint } from '@/src/common/lib/polycentric-hooks/helpers';
import { mentionsToPlainText } from '@/src/common/util/parseTextLinks';
import { Atoms, useTheme, withHexOpacity } from '@/src/common/theme';
import { Post } from '@/src/features/post/Post';
import { ClaimTypeChip } from '@/src/features/verifications/claims/toolbar/ClaimTypeChip';
import type { DecodedClaim } from '@/src/features/verifications/hooks/useClaimById';
import { CLAIM_TYPES } from '@/src/features/verifications/utils/forms';
import { getPlatformFromClaim } from '@/src/features/verifications/utils/platforms';
import { resolveClaimTitle } from '@/src/features/verifications/utils/render';
import { useProfile } from '@/src/features/profile/hooks/useProfile';
import { type Href, router } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import type {
  NotificationData,
  QuoteNotification,
  ReplyNotification,
} from './utils';

/** Notifications rendered as the actor's own post. */
type PostNotification = ReplyNotification | QuoteNotification;

/** Route to a post's thread, or `null` when its key can't be fingerprinted. */
function postRoute(post: PostData) {
  const fingerprint = getKeyFingerprint(post.signedBy);
  return fingerprint
    ? Routes.tabs.post(post.identity, fingerprint, post.sequence)
    : null;
}

/** What the actor did, e.g. "reacted to your post". */
function summary(
  notification: Exclude<NotificationData, PostNotification>,
): string {
  switch (notification.kind) {
    case 'follow':
      return 'followed you';
    case 'repost':
      return 'reposted your post';
    case 'reaction':
      return notification.emoji
        ? `reacted ${notification.emoji} to your post`
        : 'reacted to your post';
    case 'verificationRequest':
      return 'requested a verification from you';
    case 'verificationComplete':
      return 'completed your verification request';
  }
}

/** Your post, shown as a quoted block — the thing acted upon. */
function quotedPost(
  notification: Exclude<NotificationData, PostNotification>,
): PostData | undefined {
  switch (notification.kind) {
    case 'reaction':
    case 'repost':
      return notification.targetPost;
    case 'follow':
    case 'verificationRequest':
    case 'verificationComplete':
      return undefined;
  }
}

/** Where tapping the notification navigates, beyond the actor's profile. */
function notificationRoute(
  notification: Exclude<NotificationData, PostNotification>,
): Href | null {
  switch (notification.kind) {
    case 'follow':
      return null;
    case 'reaction':
    case 'repost':
      return notification.targetPost
        ? postRoute(notification.targetPost)
        : null;
    case 'verificationRequest':
    case 'verificationComplete': {
      const key = notification.claimKey;
      const fingerprint = getKeyFingerprint(key?.signedBy);
      return key && fingerprint
        ? Routes.tabs.verification(
            key.identity,
            fingerprint,
            String(key.sequence),
          )
        : null;
    }
  }
}

export default function Notification({
  notification,
}: {
  notification: NotificationData;
}) {
  // Replies and quotes are just the actor's post (the quote embeds the
  // quoted post itself).
  if (notification.kind === 'reply') {
    return <Post post={notification.reply} />;
  }
  if (notification.kind === 'quote') {
    return <Post post={notification.quote} />;
  }
  return <InteractionNotification notification={notification} />;
}

/** Follow / repost / reaction, rendered as an actor + action row with an
 *  optional quoted post. */
function InteractionNotification({
  notification,
}: {
  notification: Exclude<NotificationData, PostNotification>;
}) {
  const { theme } = useTheme();
  const profile = useProfile(notification.fromIdentity);
  const name = profile.name ?? 'Anonymous';

  const quoted = quotedPost(notification);

  const handlePress = useCallback(() => {
    router.push(
      notificationRoute(notification) ??
        Routes.tabs.profile(notification.fromIdentity),
    );
  }, [notification]);

  const openProfile = useCallback(
    () => router.push(Routes.tabs.profile(notification.fromIdentity)),
    [notification.fromIdentity],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={[
        Atoms.flex_row,
        Atoms.gap_md,
        Atoms.p_md,
        {
          borderBottomWidth: 1,
          borderBottomColor: withHexOpacity(theme.palette.neutral_500, '20'),
        },
      ]}
    >
      <ProfileAvatar
        identityKey={notification.fromIdentity}
        size="md"
        onPress={openProfile}
      />
      <View style={[Atoms.flex_1, Atoms.gap_xs]}>
        <View
          style={[Atoms.flex_row, Atoms.items_center, { flexWrap: 'wrap' }]}
        >
          <Text
            fontWeight="bold"
            numberOfLines={1}
            style={Atoms.flex_shrink_1}
            onPress={openProfile}
          >
            {name}
          </Text>
          <Text>
            {' '}
            {summary(notification)}
            {notification.createdAt > 0 ? (
              <Text color="neutral_500">
                {' '}
                · {timeAgo(notification.createdAt)}
              </Text>
            ) : null}
          </Text>
        </View>

        {/* The post the action was taken against, quoted. */}
        {quoted?.content ? (
          <View style={[]}>
            <Text variant="secondary" color="neutral_500" numberOfLines={2}>
              {mentionsToPlainText(quoted.content)}
            </Text>
          </View>
        ) : null}

        {/* The claim in question: its type and title. */}
        {(notification.kind === 'verificationRequest' ||
          notification.kind === 'verificationComplete') &&
        notification.claim ? (
          <ClaimSummary claim={notification.claim} />
        ) : null}
      </View>
    </Pressable>
  );
}

/** A claim's type chip and title, as the verifications inbox titles them. */
function ClaimSummary({ claim }: { claim: DecodedClaim }) {
  const { title } = resolveClaimTitle(claim.schemaName, claim.fields);
  const claimType = CLAIM_TYPES.find((t) => t.name === claim.schemaName);
  // Platform claims chip as their platform (brand logo + name).
  const platform = getPlatformFromClaim(claim.schemaName, claim.fields);

  return (
    <View style={[Atoms.flex_row, Atoms.align_center, Atoms.gap_sm]}>
      <ClaimTypeChip
        name={platform?.name ?? claim.schemaName}
        icon={claimType?.icon ?? 'verify'}
        logo={platform?.logo}
        color={platform?.color ?? claimType?.color}
      />
      <Text variant="secondary" color="neutral_500" numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}
