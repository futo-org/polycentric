import { BackButton } from '@/src/common/components/composites';
import HoverCard from '@/src/common/components/HoverCard';
import Icon from '@/src/common/components/Icon';
import { openProfilePhoto } from '@/src/features/profile/ProfilePhotoScreen';
import {
  Button,
  ProfileAvatar,
  Text,
} from '@/src/common/components/primitives';
import { Routes } from '@/src/common/constants';
import { truncateName, useUsername } from '@/src/common/lib/polycentric-hooks';
import { Atoms, useTheme } from '@/src/common/theme';
import { isWeb } from '@/src/common/util/platform';
import { useProfile } from '@/src/features/profile/hooks/useProfile';
import { FetchMode } from '@polycentric/react-native';
import { router, type Href } from 'expo-router';
import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';
import FollowButton from '../follow/FollowButton';
import { useProfileContext } from './ProfileContext';
import ProfileMenu from './ProfileMenu';

const BANNER_HEIGHT = 150;

export interface ProfileHeaderProps {
  bannerColors: [string, string];
  onBack: () => void;
}

function ProfileHeaderInner({ bannerColors, onBack }: ProfileHeaderProps) {
  const { theme } = useTheme();
  const { identityKey, isSelf, alias } = useProfileContext();

  const fallbackUsername = useUsername(identityKey);
  const profile = useProfile(identityKey, { fetchMode: FetchMode.Default });

  const username = profile.name ?? fallbackUsername;

  const displayKey = identityKey ? identityKey.slice(0, 64) : '...';

  const handleEdit = useCallback(() => {
    if (identityKey) router.push(Routes.tabs.editProfile(identityKey));
  }, [identityKey]);

  const handleIdentityPress = useCallback(() => {
    if (identityKey) router.push(Routes.tabs.profileIdentity(identityKey));
  }, [identityKey]);

  const handleAvatarPress = useCallback(() => {
    if (!identityKey) return;
    openProfilePhoto(identityKey);
  }, [identityKey]);

  if (profile.isLoading && !profile.name) return undefined;

  return (
    <View style={{ backgroundColor: theme.palette.neutral_0 }}>
      <View style={{ position: 'relative' }}>
        <View
          style={{
            height: BANNER_HEIGHT,
            backgroundColor: bannerColors[1],
            overflow: 'hidden',
          }}
        >
          <View
            style={[
              Atoms.absolute,
              {
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: bannerColors[0],
                opacity: 0.5,
              },
            ]}
          />
        </View>
        <View
          style={[
            Atoms.absolute,
            { top: 0, left: 0 },
            Atoms.mx_lg,
            Atoms.mt_md,
          ]}
        >
          <BackButton onPress={onBack} />
        </View>
      </View>

      <View style={[Atoms.mx_lg, { marginTop: -56 }]}>
        {identityKey ? (
          <ProfileAvatar
            identityKey={identityKey}
            size="xl"
            onPress={handleAvatarPress}
          />
        ) : null}
      </View>

      <View
        style={[
          Atoms.mx_lg,
          Atoms.pb_lg,
          Atoms.flex_row,
          Atoms.justify_between,
          Atoms.gap_md,
        ]}
      >
        {/* Flexible, shrinkable column: `minWidth: 0` lets a long unbreakable
            alias truncate instead of forcing the row wider and pushing the
            action button off-screen. */}
        <View
          style={[Atoms.mt_md, Atoms.gap_xs, Atoms.flex_1, { minWidth: 0 }]}
        >
          <Text variant="title" fontWeight="bold">
            {truncateName(username, 32)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View identity details"
            onPress={handleIdentityPress}
            style={({ pressed }) => [
              Atoms.flex_row,
              Atoms.items_center,
              Atoms.gap_xs,
              pressed && { opacity: 0.5 },
            ]}
          >
            <Icon name="key" size={13} color="neutral_500" />
            <IdentityKeyText value={displayKey} />
          </Pressable>
          {alias ? <AliasLabel alias={alias} /> : null}
          {profile.description ? (
            <View style={Atoms.mt_sm}>
              <Text variant="body" fontSize="sm" color="neutral_1000">
                {profile.description}
              </Text>
            </View>
          ) : null}
          {identityKey ? (
            <FollowCounts
              identityKey={identityKey}
              following={profile.followingCount}
              followers={profile.followersCount}
            />
          ) : null}
        </View>

        <View
          style={[
            Atoms.mt_md,
            Atoms.flex_row,
            Atoms.items_center,
            Atoms.gap_sm,
            { flexShrink: 0 },
          ]}
        >
          <ProfileMenu />
          {isSelf ? (
            <Button
              title="Edit profile"
              onPress={handleEdit}
              variant="tertiary"
              size="sm"
            />
          ) : (
            <FollowButton identity={identityKey!} />
          )}
        </View>
      </View>
    </View>
  );
}

const KEY_TAIL_LENGTH = 8;

// Web has no middle ellipsis, so the tail is kept in its own Text.
function IdentityKeyText({ value }: { value: string }) {
  if (!isWeb) {
    return (
      <Text
        variant="secondary"
        color="neutral_500"
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{ flexShrink: 1 }}
      >
        {value}
      </Text>
    );
  }
  return (
    <View style={[Atoms.flex_row, { flexShrink: 1, minWidth: 0 }]}>
      <Text
        variant="secondary"
        color="neutral_500"
        numberOfLines={1}
        style={{ flexShrink: 1, minWidth: 0 }}
      >
        {value.slice(0, -KEY_TAIL_LENGTH)}
      </Text>
      <Text variant="secondary" color="neutral_500" style={{ flexShrink: 0 }}>
        {value.slice(-KEY_TAIL_LENGTH)}
      </Text>
    </View>
  );
}

// Following / followers counts linking to their lists.
function FollowCounts({
  identityKey,
  following,
  followers,
}: {
  identityKey: string;
  following: number;
  followers: number;
}) {
  const counts: {
    label: string;
    count: number;
    route: Href;
  }[] = [
    {
      label: 'Following',
      count: following,
      route: Routes.tabs.profileFollowing(identityKey),
    },
    {
      label: 'Followers',
      count: followers,
      route: Routes.tabs.profileFollowers(identityKey),
    },
  ];

  return (
    <View style={[Atoms.flex_row, Atoms.gap_md, Atoms.mt_sm]}>
      {counts.map(({ label, count, route }) => (
        <Pressable
          key={label}
          accessibilityRole="link"
          onPress={() => router.push(route)}
          style={({ pressed }) => [pressed && { opacity: 0.5 }]}
        >
          <Text variant="secondary" color="neutral_500" selectable={false}>
            <Text variant="secondary" fontWeight="semibold">
              {count}
            </Text>{' '}
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The verified alias, truncated to one line so it can't push the
 * action button off-screen. Built on the shared HoverCard (hover on web, tap on
 * native), which portals + positions the reveal bubble correctly here.
 */
function AliasLabel({ alias }: { alias: string }) {
  const { theme } = useTheme();

  return (
    <HoverCard openDelay={0}>
      {/* `asChild` so the style array lands on an RN Pressable (which RN-Web
          resolves) rather than being forwarded as-is to a DOM element. */}
      <HoverCard.Trigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={alias}
          style={[Atoms.flex_row, Atoms.items_center, Atoms.gap_xs]}
        >
          <Icon name="at" size={13} color="neutral_500" />
          <Text
            variant="secondary"
            color="neutral_500"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {alias}
          </Text>
        </Pressable>
      </HoverCard.Trigger>
      <HoverCard.Content side="bottom" align="start" animated={false}>
        <View
          style={[
            Atoms.p_sm,
            {
              maxWidth: 320,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.palette.neutral_300,
              backgroundColor: theme.palette.background_secondary,
            },
          ]}
        >
          <Text variant="secondary" color="neutral_900">
            {alias}
          </Text>
        </View>
      </HoverCard.Content>
    </HoverCard>
  );
}

export const ProfileHeader = memo(ProfileHeaderInner);
