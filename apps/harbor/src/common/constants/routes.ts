import { router } from 'expo-router';
import { withIdentity } from '../lib/authGate';
import type { PostData } from '../lib/polycentric-hooks';

/** Query param carrying where onboarding should land the user afterwards. */
export const RETURN_TO_PARAM = 'returnTo';

/** In-app absolute paths only, so `?returnTo=` cannot redirect off-site.
 *  `/` is excluded: the onboarding welcome screen also serves it. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\/(?!\/)/.test(value)) return null;
  return value === '/' ? null : value;
}

export type OpenComposeOptions = {
  replyTo?: PostData['id'];
  quote?: PostData['id'];
  /** Immediately launch the image picker once the composer mounts. */
  attachImage?: boolean;
};

export function openCompose(options: OpenComposeOptions = {}) {
  const { replyTo, quote, attachImage } = options;
  const params = new URLSearchParams();
  if (replyTo) {
    params.set('replyTo', replyTo);
  }
  if (quote) {
    params.set('quote', quote);
  }
  if (attachImage) params.set('attach', '1');
  const queryString = params.toString();
  withIdentity(() =>
    router.push(
      queryString
        ? `${Routes.tabs.feed.compose}?${queryString}`
        : Routes.tabs.feed.compose,
    ),
  );
}

export const Routes = {
  tabs: {
    feed: {
      index: '/feed',
      compose: '/feed/compose',
    },
    search: '/search',
    explore: {
      index: '/explore',
      people: '/explore/people',
      search: '/explore/search',
    },
    claims: '/claims',
    identitySwitch: '/identity/switch',
    profile: (identityId: string) => `/${identityId}` as const,
    profileVerificationClaims: (identityId: string) =>
      `/${identityId}/verifications/claims` as const,
    profileVerificationVerifies: (identityId: string) =>
      `/${identityId}/verifications/verifies` as const,
    profileFollowing: (identityId: string) =>
      `/${identityId}/following` as const,
    profileFollowers: (identityId: string) =>
      `/${identityId}/followers` as const,
    editProfile: (identityId: string) => `/${identityId}/edit` as const,
    profileIdentity: (identityId: string) => `/${identityId}/identity` as const,
    profilePhoto: (identityId: string) => `/${identityId}/photo` as const,
    post: (identityId: string, keyFingerprint: string, sequence: string) =>
      `/${identityId}/post/${keyFingerprint}/${sequence}` as const,
    postImage: (
      identityId: string,
      keyFingerprint: string,
      sequence: string,
      /** 1-based image position, as it appears in the URL. */
      index: number,
    ) =>
      `/${identityId}/post/${keyFingerprint}/${sequence}/image/${index}` as const,
    verification: (
      identityId: string,
      keyFingerprint: string,
      sequence: string,
    ) => `/${identityId}/verifications/${keyFingerprint}/${sequence}` as const,
    settings: {
      index: '/settings',
      identity: '/settings/identity',
      pairIdentity: '/settings/pair-identity',
      createBackup: '/settings/create-backup',
      checkBackup: '/settings/check-backup',
      servers: '/settings/servers',
      verificationAuthorities: '/settings/verification-authorities',
      privateKey: '/settings/private-key',
      appearance: '/settings/appearance',
      moderationSettings: '/settings/moderation-settings',
      blockedTopics: '/settings/blocked-topics',
      blockedUsers: '/settings/blocked-users',
      clientInformation: '/settings/client-information',
      switchIdentity: '/settings/switch-identity',
      removeIdentities: '/settings/remove-identities',
      reportBug: '/settings/report-bug',
    },
    moderation: {
      dashboard: '/moderation/dashboard',
      banList: '/moderation/ban-list',
    },
  },
  onboarding: {
    index: '/',
    login: '/login',
    pair: '/login/pair',
    recover: '/login/recover',
    signup: {
      index: '/signup',
      about: '/signup/about',
      avatar: '/signup/avatar',
      moderation: '/signup/moderation',
    },
  },
} as const;
