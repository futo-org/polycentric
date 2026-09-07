import { ExternalLink, Text } from '@/src/common/components/primitives';
import { Routes } from '@/src/common/constants';
import type { PostData } from '@/src/common/lib/polycentric-hooks';
import {
  hexToBytes,
  thirdPartyApplication,
} from '@/src/common/lib/polycentric-hooks/helpers';
import { useWebHover } from '@/src/common/lib/useWebHover';
import { Atoms } from '@/src/common/theme';
import { useProfile } from '@/src/features/profile/hooks/useProfile';
import { v2 } from '@polycentric/react-native';
import { type ExternalPathString, router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { PostImages } from '../PostImages';
import { PostLabels } from '../PostLabels';
import { PostText } from '../PostText';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PostContentQuote } from './PostContentQuote';

const PREVIEW_LIMIT = 240;
const MAX_DISPLAY_LIMIT = 2000;

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
    <View style={[Atoms.gap_2xs, Atoms.mr_3xl]}>
      {replyParentId || withApp ? (
        <View style={[Atoms.flex_row, Atoms.align_center, Atoms.max_w_full]}>
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
        focusedView ? (
          <PostText
            content={post.content.slice(0, MAX_DISPLAY_LIMIT)}
            large
            selectable
          />
        ) : (
          <ExpandablePostText content={post.content} />
        )
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

/** Post text capped at PREVIEW_LIMIT with a Show more / Show less toggle. */
function ExpandablePostText({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  const { displayContent, isTruncatedPreview, showToggle } = useMemo(() => {
    const capped =
      content.length > MAX_DISPLAY_LIMIT
        ? content.slice(0, MAX_DISPLAY_LIMIT)
        : content;
    const shown =
      expanded || capped.length <= PREVIEW_LIMIT
        ? capped
        : capped.slice(0, PREVIEW_LIMIT);
    const toggle = content.length > PREVIEW_LIMIT;
    return {
      displayContent: shown,
      isTruncatedPreview: !expanded && toggle,
      showToggle: toggle,
    };
  }, [content, expanded]);

  const { hovered, onHoverIn, onHoverOut } = useWebHover();

  const toggleExpanded = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  return (
    <>
      <PostText
        content={displayContent}
        suffix={isTruncatedPreview ? '...' : ''}
      />
      {showToggle && (
        <Pressable
          onPress={toggleExpanded}
          onHoverIn={onHoverIn}
          onHoverOut={onHoverOut}
          style={[Atoms.self_start]}
        >
          {!expanded && (
            <Text
              variant="body"
              color="primary_500"
              style={hovered ? { textDecorationLine: 'underline' } : undefined}
            >
              Show more
            </Text>
          )}
        </Pressable>
      )}
    </>
  );
}

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
        <ExternalLink href={url as ExternalPathString} target="_blank">
          {label}
        </ExternalLink>
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
