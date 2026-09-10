import { Text } from '@/src/common/components/primitives';
import { Routes } from '@/src/common/constants/routes';
import { useWebHover } from '@/src/common/lib/useWebHover';
import { Atoms, useTheme } from '@/src/common/theme';
import {
  parseTextLinks,
  truncateSegments,
  type TextSegment,
} from '@/src/common/util/parseTextLinks';
import { isWeb } from '@/src/common/util/platform';
import { type Href, Link, router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable } from 'react-native';

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
      truncateSegments(
        parsedSegments,
        truncateToPreview ? PREVIEW_LIMIT : MAX_DISPLAY_LIMIT,
      ),
    [parsedSegments, truncateToPreview],
  );

  const size: PostTextSize = large ? { fontSize: 'lg', lineHeight: 'lg' } : {};

  return (
    <>
      <Text variant="secondary" selectable={selectable} {...size}>
        {segments.map((segment) => (
          <Segment key={segment.start} segment={segment} size={size} />
        ))}
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

function Segment({
  segment,
  size,
}: {
  segment: TextSegment;
  size: PostTextSize;
}) {
  const { theme } = useTheme();

  if (segment.type === 'text') return segment.value;

  const href = buildSegmentHref(segment);

  if (isWeb) {
    return (
      <Link
        className="underlineOnHover"
        href={href}
        target={segment.type === 'link' ? '_blank' : undefined}
        style={{ color: theme.palette.primary_500 }}
        // Don't open the surrounding post card.
        onPress={(e) => e.stopPropagation?.()}
      >
        {segment.value}
      </Link>
    );
  }

  return (
    <Text
      variant="secondary"
      color="primary_500"
      fontWeight="regular"
      {...size}
      onPress={(e) => {
        // Don't open the surrounding post card.
        e.stopPropagation?.();
        // expo-router hands URLs (anything with a scheme) to Linking.openURL
        // and navigates in-app otherwise.
        router.push(href);
      }}
    >
      {segment.value}
    </Text>
  );
}

function buildSegmentHref(
  segment: Exclude<TextSegment, { type: 'text' }>,
): Href {
  switch (segment.type) {
    case 'link':
      return segment.url as Href;
    case 'hashtag':
      return {
        pathname: Routes.tabs.explore.search,
        params: { q: segment.tag },
      };
    case 'alias':
      return Routes.tabs.profile(segment.alias);
    case 'identity':
      return Routes.tabs.profile(segment.identity);
  }
}
