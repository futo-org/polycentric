import { Text } from '@/src/common/components/primitives';
import { Routes } from '@/src/common/constants/routes';
import {
  parseTextLinks,
  type TextSegment,
} from '@/src/common/util/parseTextLinks';
import { router } from 'expo-router';
import { memo, useMemo } from 'react';
import { Linking } from 'react-native';

type PostTextSize = { fontSize?: 'lg'; lineHeight?: 'lg' };

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

/** Renders post body text with tappable links and mentions. */
export const PostText = memo(function PostText({
  content,
  suffix,
  large = false,
  selectable = false,
}: {
  content: string;
  suffix?: string;
  /** Detail-view sizing for a focused post. */
  large?: boolean;
  selectable?: boolean;
}) {
  const segments = useMemo(() => parseTextLinks(content), [content]);
  const size: PostTextSize = large ? { fontSize: 'lg', lineHeight: 'lg' } : {};

  return (
    <Text variant="secondary" selectable={selectable} {...size}>
      {segments.map((segment, key) => renderSegment(segment, key, size))}
      {suffix}
    </Text>
  );
});
