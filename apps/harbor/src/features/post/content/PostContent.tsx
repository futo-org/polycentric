import { Text } from '@/src/common/components/primitives';
import { Routes } from '@/src/common/constants';
import type { PostData } from '@/src/common/lib/polycentric-hooks';
import {
  hexToBytes,
  thirdPartyApplication,
} from '@/src/common/lib/polycentric-hooks/helpers';
import { Atoms } from '@/src/common/theme';
import { useProfile } from '@/src/features/profile/hooks/useProfile';
import { v2 } from '@polycentric/react-native';
import { type ExternalPathString, Link, router } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { PostImages } from '../PostImages';
import { PostLabels } from '../PostLabels';
import { PostText } from '../PostText';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PostContentQuote } from './PostContentQuote';

/** A post's body: what it is replying to, its text, and its attachments. */
export const PostContent = memo(function PostContent({
  post,
  hideReplyingTo,
  compactLinkPreview,
  authorIdentity,
  focusedView = false,
}: {
  post: PostData;
  hideReplyingTo: boolean;
  compactLinkPreview: boolean;
  authorIdentity: string | null;
  /** Focused-post rendering: larger, selectable text. */
  focusedView?: boolean;
}) {
  const replyParentId = hideReplyingTo ? undefined : post.reply?.parentId;
  const withApp = thirdPartyApplication(post.application);

  return (
    <View style={Atoms.gap_2xs}>
      {replyParentId || withApp ? (
        <View
          style={[
            Atoms.flex_row,
            Atoms.align_center,
            Atoms.max_w_full,
            Atoms.mr_3xl,
          ]}
        >
          {replyParentId ? (
            <ReplyingToSubheader parentId={replyParentId} />
          ) : null}
          {withApp ? (
            <ApplicationSubheader
              {...withApp}
              prefix={replyParentId ? ' with ' : 'Posted with '}
            />
          ) : null}
        </View>
      ) : null}

      {post.labels && post.labels.length > 0 ? (
        <PostLabels labels={post.labels} authorIdentity={authorIdentity} />
      ) : null}

      {post.content ? (
        <PostText
          content={post.content}
          expandable={!focusedView}
          large={focusedView}
          selectable={focusedView}
        />
      ) : null}
      {/* Render only the first link preview. A post may carry multiple
        `links` (e.g. from another client), but we cap the UI at one. */}
      {post.links?.[0] ? (
        <LinkPreviewCard link={post.links[0]} compact={compactLinkPreview} />
      ) : null}
      {post.images?.length > 0 && <PostImages post={post} />}
      {post.quoteId ? (
        <PostContentQuote quoteId={post.quoteId} quotePost={post.quotePost} />
      ) : null}
    </View>
  );
});

function ApplicationSubheader({
  prefix,
  name,
  url,
}: {
  prefix: string;
  name: string;
  url?: string;
}) {
  const label = (
    <Text variant="secondary" color="neutral_500" fontWeight="regular">
      {name}
    </Text>
  );

  return (
    <View style={[Atoms.flex_row, Atoms.align_center, Atoms.flex_shrink_0]}>
      <Text variant="secondary" color="neutral_500" fontWeight="regular">
        {prefix}
      </Text>
      {url ? (
        <Link
          className="underlineOnHover"
          href={url as ExternalPathString}
          target="_blank"
        >
          {label}
        </Link>
      ) : (
        label
      )}
    </View>
  );
}

function ReplyingToSubheader({ parentId }: { parentId: string }) {
  const parentIdentity = useMemo(() => {
    try {
      return v2.EventKey.fromBinary(hexToBytes(parentId)).identity;
    } catch {
      return null;
    }
  }, [parentId]);

  const parentProfile = useProfile(parentIdentity);
  const parentName = parentProfile.name ?? '';

  const handlePress = useCallback(() => {
    if (!parentIdentity) return;
    router.push(Routes.tabs.profile(parentIdentity));
  }, [parentIdentity]);

  if (!parentIdentity) return null;

  return (
    <Pressable
      onPress={handlePress}
      style={[
        Atoms.flex_row,
        Atoms.align_center,
        Atoms.self_start,
        Atoms.flex_shrink_1,
        Atoms.max_w_full,
      ]}
    >
      <Text
        variant="secondary"
        color="neutral_500"
        fontWeight="regular"
        style={Atoms.flex_shrink_0}
      >
        Replying to{' '}
      </Text>
      <Text
        variant="secondary"
        color="primary_500"
        numberOfLines={1}
        style={Atoms.flex_shrink_1}
      >
        {parentName || '…'}
      </Text>
    </Pressable>
  );
}
