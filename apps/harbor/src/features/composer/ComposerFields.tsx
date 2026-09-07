import Icon from '@/src/common/components/Icon';
import {
  ProfileAvatar,
  Text,
  TextArea,
} from '@/src/common/components/primitives';
import type { PostData } from '@/src/common/lib/polycentric-hooks';
import { Atoms, Spacing, useTheme, withHexOpacity } from '@/src/common/theme';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  type TextInput as RNTextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import ComposerPostEmbed from './ComposerPostEmbed';
import { LinkPreviewCard } from '@/src/features/post/content/LinkPreviewCard';
import type { v2 } from '@polycentric/react-native';
import { singleImageAspectRatio } from './utils/attachmentLayout';
import { MAX_POST_LENGTH, type useComposer } from './hooks/useComposer';
import { isIOS, isWeb } from '@/src/common/util/platform';
import { ScrollView } from '@/src/common/components/ScrollView';

import { useMentionInputSync } from '@/src/features/composer/hooks/useMentionInputSync';

const ATTACHMENT_GAP = Spacing.sm;

type Attachment = ReturnType<typeof useComposer>['attachments'][number];

type ComposerFieldsProps = {
  isReply: boolean;
  replyTo?: PostData | null;
  quote?: PostData | null;
  error: string | null;
  currentIdentityKey: string | null;
  placeholder: string;
  text: string;
  setText: (text: string) => void;
  attachments: Attachment[];
  submitting: boolean;
  onRemoveAttachment: (id: string) => void;
  /** Live link preview for the first URL in the draft, once resolved. */
  linkPreview: v2.Link | null;
  /** True while the link preview is being fetched. */
  linkPreviewLoading: boolean;
  /**
   * Remove the link preview (X button).
   */
  onRemoveLinkPreview: () => void;
  /** Auto-focus the text field.**/
  autoFocus?: boolean;
};

/**
 * The composer form body (reply/quote previews, error, avatar + text area,
 * attachment thumbnails). Shared by the sheet composer and the full-screen
 * compose tab; each caller supplies its own padded, flex container.
 */
export function ComposerFields({
  isReply,
  replyTo,
  quote,
  error,
  currentIdentityKey,
  placeholder,
  text,
  setText,
  attachments,
  submitting,
  onRemoveAttachment,
  linkPreview,
  linkPreviewLoading,
  onRemoveLinkPreview,
  autoFocus = true,
}: ComposerFieldsProps) {
  const { theme } = useTheme();

  // On Android the field is deliberately UNCONTROLLED: round-tripping every
  // keystroke through a `value` prop makes Fabric re-apply the text natively,
  // clobbering the cursor position whenever it isn't at the very end
  // (upstream: https://github.com/facebook/react-native/issues/34276).
  // It is seeded once at mount (a `defaultValue` that keeps updating is
  // forwarded to the native `text` prop each render, same as `value`) and the
  // store is synced via `onChangeText`. iOS must stay CONTROLLED instead:
  // uncontrolled multiline inputs there never re-measure, so the field stops
  // auto-growing (https://github.com/facebook/react-native/issues/54570).
  const inputRef = useRef<RNTextInput>(null);
  const [initialText] = useState(text);
  // Last text the field is known to contain (the seed, then user input).
  const fieldTextRef = useRef(text);

  useEffect(() => {
    if (text === fieldTextRef.current) return;
    // The draft changed outside the input. Only the reset to empty (on
    // close/post) does this today; if the composer ever gains non-empty
    // programmatic edits (e.g. draft prefill), remount the field with a new
    // `key` instead of passing text back in.
    fieldTextRef.current = text;
    if (text === '') inputRef.current?.clear();
  }, [text]);

  const onChangeText = useCallback(
    (next: string) => {
      fieldTextRef.current = next;
      setText(next);
    },
    [setText],
  );

  // Feeds the host's mention store (query derivation + the overlay's anchor);
  // the autocomplete itself renders in MentionSearchOverlay, in the host.
  const mentionInput = useMentionInputSync({ text, onChangeText, inputRef });

  return (
    <ScrollView
      style={[Atoms.flex_1]}
      contentContainerStyle={Atoms.flex_grow_1}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {/* Reply preview */}
      {isReply && replyTo && <ComposerPostEmbed post={replyTo} />}

      {/* Error displays */}
      {error && (
        <View
          style={[
            Atoms.p_md,
            {
              borderBottomWidth: 1,
              borderBottomColor: withHexOpacity(
                theme.palette.negative_500,
                '80',
              ),
              marginBottom: 10,
            },
          ]}
        >
          <Text variant="secondary" color="negative_500">
            {error}
          </Text>
        </View>
      )}

      {/* Main block */}
      <View
        style={[
          Atoms.flex_row,
          Atoms.gap_md,
          Atoms.flex_grow_1,
          { minHeight: 200 },
        ]}
      >
        {currentIdentityKey ? (
          <View style={[Atoms.self_start]}>
            <ProfileAvatar identityKey={currentIdentityKey} size="md" />
          </View>
        ) : null}
        <View style={[Atoms.flex_1, Atoms.gap_sm]}>
          <TextArea
            // `autoFocus` only fires on mount, so re-key when it flips
            // (false → true after the sheet presents) to actually focus.
            key={autoFocus ? 'autofocus' : 'no-autofocus'}
            ref={inputRef}
            variant="plain"
            placeholder={placeholder}
            autoFocus={autoFocus}
            value={isIOS ? text : undefined}
            defaultValue={isIOS ? undefined : initialText}
            onChangeText={onChangeText}
            disabled={submitting}
            maxLength={MAX_POST_LENGTH}
            numberOfLines={isWeb ? 1 : undefined}
            scrollEnabled={false}
            style={[Atoms.px_0, Atoms.py_0, Atoms.pt_sm, Atoms.text_lg]}
            onLayout={mentionInput.onLayout}
            onSelectionChange={mentionInput.onSelectionChange}
            onFocus={mentionInput.onFocus}
            onBlur={mentionInput.onBlur}
            onContentSizeChange={mentionInput.onContentSizeChange}
          />

          {attachments.length > 0 && (
            <AttachmentGrid
              attachments={attachments}
              disabled={submitting}
              onRemoveAttachment={onRemoveAttachment}
            />
          )}
          {/* Live link preview for the first URL in the draft */}
          <ComposerLinkPreview
            link={linkPreview}
            loading={linkPreviewLoading}
            disabled={submitting}
            onRemove={onRemoveLinkPreview}
          />
          {/* Quote preview */}
          {!!quote && <ComposerPostEmbed post={quote} intentText="Quoting" />}
          {/* Tap-to-focus filler for the space below the content */}
          <Pressable
            style={Atoms.flex_grow_1}
            onPress={() => inputRef.current?.focus()}
            accessible={false}
          />
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Live link preview shown while composing: a loading row until the unfurl
 * resolves, then the same `LinkPreviewCard` used in the feed (so the composer
 * preview matches what the post will look like). Both states carry an X
 * button that removes the preview from the draft.
 */
function ComposerLinkPreview({
  link,
  loading,
  disabled,
  onRemove,
}: {
  link: v2.Link | null;
  loading: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { theme } = useTheme();

  if (!link && !loading) return null;

  return (
    <View>
      {link ? (
        <LinkPreviewCard link={link} />
      ) : (
        <View
          style={[
            Atoms.flex_row,
            Atoms.align_center,
            Atoms.gap_sm,
            Atoms.p_md,
            Atoms.rounded_md,
            Atoms.mt_md,
            {
              borderWidth: 1,
              borderColor: withHexOpacity(theme.palette.neutral_500, '30'),
            },
          ]}
        >
          <ActivityIndicator size="small" color={theme.palette.neutral_500} />
          <Text variant="secondary" color="neutral_500">
            Loading preview…
          </Text>
        </View>
      )}
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        accessibilityLabel="Remove link preview"
        hitSlop={6}
        style={{
          position: 'absolute',
          // Below the card's own mt_md top margin (margins stay inside the
          // wrapper, so the card's top edge is Spacing.md down from ours).
          top: Spacing.md + 4,
          right: 4,
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withHexOpacity(theme.palette.black, 'b0'),
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Icon name="close" size={14} color="white" />
      </Pressable>
    </View>
  );
}

/**
 * Lays out 1–4 attachments: a single image spans the full width at its natural
 * (clamped) aspect ratio, while two or more wrap into a 50%-width square grid
 * (two per row → 2-up, 3+1, or 2x2).
 */
function AttachmentGrid({
  attachments,
  disabled,
  onRemoveAttachment,
}: {
  attachments: Attachment[];
  disabled: boolean;
  onRemoveAttachment: (id: string) => void;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const single = attachments.length === 1;

  const onLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  // Two columns: each item is half the row minus half the inter-item gap.
  const gridItemWidth = containerWidth
    ? (containerWidth - ATTACHMENT_GAP) / 2
    : undefined;

  return (
    <View
      onLayout={onLayout}
      style={[Atoms.flex_row, Atoms.flex_wrap, Atoms.gap_sm, Atoms.mt_sm]}
    >
      {attachments.map((a) => (
        <AttachmentThumb
          key={a.id}
          uri={a.uri}
          status={a.status}
          width={single ? '100%' : gridItemWidth}
          aspectRatio={single ? singleImageAspectRatio(a) : 1}
          disabled={disabled}
          onRemove={() => onRemoveAttachment(a.id)}
        />
      ))}
    </View>
  );
}

function AttachmentThumb({
  uri,
  disabled,
  onRemove,
  width,
  aspectRatio,
  status,
}: {
  uri: string;
  disabled: boolean;
  onRemove: () => void;
  width?: number | '100%';
  aspectRatio: number;
  status: Attachment['status'];
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width,
        aspectRatio,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: withHexOpacity(theme.palette.neutral_500, '20'),
      }}
    >
      <Image
        source={{ uri }}
        recyclingKey={uri}
        contentFit="cover"
        style={{ width: '100%', height: '100%' }}
      />
      {/* Loading / error overlay while the blobs are being processed+uploaded */}
      {status !== 'ready' && (
        <View
          style={[
            Atoms.items_center,
            Atoms.justify_center,
            {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: withHexOpacity(
                status === 'error'
                  ? theme.palette.negative_500
                  : theme.palette.black,
                '40',
              ),
            },
          ]}
        >
          {status === 'error' ? (
            <Icon name="ban" size={22} color="white" />
          ) : (
            <ActivityIndicator size="small" color="white" />
          )}
        </View>
      )}
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        accessibilityLabel="Remove attachment"
        hitSlop={6}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withHexOpacity(theme.palette.black, 'b0'),
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <Icon name="close" size={14} color="white" />
      </Pressable>
    </View>
  );
}
