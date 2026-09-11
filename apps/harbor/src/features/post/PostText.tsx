import { Text } from '@/src/common/components/primitives';
import { Routes } from '@/src/common/constants/routes';
import { useWebHover } from '@/src/common/lib/useWebHover';
import { Atoms } from '@/src/common/theme';
import {
  parseTextLinks,
  truncateSegments,
  type TextSegment,
} from '@/src/common/util/parseTextLinks';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Linking, Pressable } from 'react-native';

const PREVIEW_LIMIT = 240;
const MAX_DISPLAY_LIMIT = 2000;

type PostTextSize = { fontSize?: 'lg'; lineHeight?: 'lg' };

/**
 * Renders post body text with tappable links and mentions.
 */
export const PostText = memo(function PostText({
  content,
  expandable = false,
  large = false,
  selectable = false,
}: {
  content: string;
  /** Feed rendering: preview-capped with a Show more toggle. */
  expandable?: boolean;
  /** Detail-view sizing for a focused post. */
  large?: boolean;
  selectable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const truncateToPreview = expandable && !expanded;

  const parsedSegments = useMemo(() => parseTextLinks(content), [content]);
  const { segments, truncated } = useMemo(
    () =>
      // A preview never shows half a mention; the hard cap cuts anywhere.
      truncateSegments(
        parsedSegments,
        truncateToPreview ? PREVIEW_LIMIT : MAX_DISPLAY_LIMIT,
        { atomic: truncateToPreview },
      ),
    [parsedSegments, truncateToPreview],
  );

  const size: PostTextSize = large ? { fontSize: 'lg', lineHeight: 'lg' } : {};

  return (
    <>
      <Text variant="secondary" selectable={selectable} {...size}>
        {segments.map((segment, key) => renderSegment(segment, key, size))}
        {truncated ? '…' : ''}
      </Text>
      {truncateToPreview && truncated ? (
        <ShowMoreToggle onPress={() => setExpanded(true)} />
      ) : null}
    </>
  );
});

function ShowMoreToggle({ onPress }: { onPress: () => void }) {
  const { hovered, onHoverIn, onHoverOut } = useWebHover();

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      style={[Atoms.self_start]}
    >
      <Text
        variant="body"
        color="primary_500"
        style={hovered ? { textDecorationLine: 'underline' } : undefined}
      >
        Show more
      </Text>
    </Pressable>
  );
}

/**
 * Render one parsed segment: plain text, a hyperlink (URLs/bare domains,
 * opened in the browser), a hashtag (navigates to search), or a mention — an
 * alias (`@user@domain.com`) or identity (`@<64-hex>`) — that navigates to
 * that profile in-app. The tap is stopped from also triggering the
 * surrounding post-card press.
 */
function renderSegment(segment: TextSegment, key: number, size: PostTextSize) {
  if (segment.type === 'text') {
    return segment.value;
  }

  return (
    <Text
      key={key}
      variant="secondary"
      color="primary_500"
      fontWeight="regular"
      {...size}
      onPress={(e) => {
        e.stopPropagation?.();
        if (segment.type === 'link') {
          void Linking.openURL(segment.url).catch(() => {});
        } else if (segment.type === 'hashtag') {
          router.push({
            pathname: Routes.tabs.explore.search,
            params: { q: segment.tag },
          });
        } else {
          router.push({
            pathname: '/[identityId]',
            params: {
              identityId:
                segment.type === 'alias' ? segment.alias : segment.identity,
            },
          });
        }
      }}
    >
      {segment.value}
    </Text>
  );
}
