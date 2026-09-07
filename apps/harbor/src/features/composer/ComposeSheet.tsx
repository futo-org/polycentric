import { Screen } from '@/src/common/components/layout';
import Topbar from '@/src/common/components/layout/Topbar';
import { Button, Text } from '@/src/common/components/primitives';
import { Sheet } from '@/src/common/components/sheet';
import type { PostData } from '@/src/common/lib/polycentric-hooks';
import { Atoms, Spacing, useTheme } from '@/src/common/theme';
import { isWeb } from '@/src/common/util/platform';
import type { types } from '@polycentric/react-native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { ComposeSheetFooterBar } from './ComposeSheetFooterBar';
import { ComposerFields } from './ComposerFields';
import { useComposer } from './hooks/useComposer';
import { MentionSearchOverlay } from './components/MentionSearchOverlay';
import { MentionProvider } from './hooks/useMentionStore';

type ComposeSheetProps = {
  /** TODO: should be v2 `SignedEvent` */
  onPostCreated: (signedEvent: types.SignedEvent) => void | Promise<void>;
  replyTo?: PostData | null;
  quote?: PostData | null;
  /** Open the image picker as soon as the composer mounts. */
  attachOnMount?: boolean;
};

export function ComposeSheet({
  onPostCreated,
  replyTo,
  quote,
  attachOnMount = false,
}: ComposeSheetProps) {
  const { theme } = useTheme();

  // The composer is presented as a route modal; closing pops it.
  const onClose = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, []);

  const composer = useComposer({
    onPostCreated,
    replyTo,
    quote,
    attachOnMount,
    onClose,
  });

  // Focus the field only after the sheet has presented (iOS fix)
  const [autoFocus, setAutoFocus] = useState(false);

  const postAction = composer.submitting ? (
    <ActivityIndicator
      size="small"
      color={theme.palette.primary_500}
      accessibilityLabel="Posting"
    />
  ) : (
    <Button
      title={'Post'}
      testID="composeSubmit"
      onPress={composer.handlePost}
      variant="primary"
      disabled={!composer.canPost}
      size="sm"
    />
  );

  const fields = (
    <ComposerFields
      isReply={composer.isReply}
      replyTo={composer.replyTo}
      quote={composer.quote}
      error={composer.error}
      currentIdentityKey={composer.currentIdentityKey}
      placeholder={composer.placeholder}
      text={composer.text}
      setText={composer.setText}
      attachments={composer.attachments}
      submitting={composer.submitting}
      onRemoveAttachment={composer.handleRemoveAttachment}
      linkPreview={composer.linkPreview}
      linkPreviewLoading={composer.linkPreviewLoading}
      onRemoveLinkPreview={composer.handleRemoveLinkPreview}
      autoFocus={isWeb ? autoFocus : true}
    />
  );

  const footer = (
    <ComposeSheetFooterBar
      variant={isWeb ? 'web' : 'native'}
      charCount={composer.text.length}
      submitting={composer.submitting}
      canPost={composer.canPost}
      onPost={composer.handlePost}
      onAttachImage={() => void composer.handleAttachImage()}
      onCaptureImage={
        isWeb ? undefined : () => void composer.handleCaptureImage()
      }
      attachDisabled={composer.attachDisabled}
    />
  );

  if (!isWeb) {
    return (
      <Screen keyboardAvoiding>
        <Screen.PrimaryColumn>
          <Topbar
            title={composer.title}
            left={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={composer.handleClose}
                hitSlop={Spacing.lg}
                style={({ pressed }) => [pressed && { opacity: 0.5 }]}
              >
                <Text color="neutral_500">Cancel</Text>
              </Pressable>
            }
            right={postAction}
          />

          <MentionProvider>
            <ScrollView
              style={Atoms.flex_1}
              contentContainerStyle={Atoms.p_lg}
              keyboardShouldPersistTaps="handled"
            >
              {fields}
            </ScrollView>
            <MentionSearchOverlay />
          </MentionProvider>

          {footer}
        </Screen.PrimaryColumn>
      </Screen>
    );
  }

  return (
    <Sheet
      detents={[1]}
      onPresented={() => setAutoFocus(true)}
      footer={footer}
      header={
        <Sheet.Header
          title={composer.title}
          onClose={composer.handleClose}
          right={postAction}
        />
      }
    >
      <Sheet.Content
        scrollable={false}
        style={[
          Atoms.py_lg,
          Atoms.px_lg,
          {
            minHeight: 200,
          },
        ]}
      >
        {/* The web Sheet teleports its content through a portal, which
            re-mounts children under the app's PortalHost — a provider outside
            the Sheet is not an ancestor there, so it must live inside. */}
        <MentionProvider>
          {fields}
          <MentionSearchOverlay />
        </MentionProvider>
      </Sheet.Content>
    </Sheet>
  );
}
