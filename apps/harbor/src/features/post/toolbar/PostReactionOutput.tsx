import { EmojiImage } from '@/src/common/components/EmojiImage';
import type { PostData } from '@/src/common/lib/polycentric-hooks';
import { Atoms } from '@/src/common/theme';
import ReactionDetailsSheet from '@/src/features/reaction/ReactionDetailsSheet';
import { previewOtherReactions } from '@/src/features/reaction/util';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import useReactions from '../../reaction/useReactions';

/** Max number of stacked emojis shown in the expanded output. */
const MAX_STACKED = 3;

const EMOJI_SIZE = 18;

type PostReactionOutputProps = {
  post: PostData;
};

export default function PostReactionOutput({ post }: PostReactionOutputProps) {
  const myReaction = useReactions((s) => s.reactions.get(post.id));
  const myEmoji =
    myReaction?.positive && myReaction.emoji ? myReaction.emoji : undefined;

  const others = useMemo(
    () => previewOtherReactions(post, myEmoji, MAX_STACKED),
    [post, myEmoji],
  );

  // Reaction details sheet state
  const [open, setOpen] = useState(false);

  const hasReactions = others.length > 0 || myEmoji !== undefined;

  // Display a button with a preview of the reactions if there is at least
  // one reaction to show
  const previewButton = hasReactions ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View reactions"
      onPress={() => setOpen(true)}
      style={({ pressed, hovered }) => [
        Atoms.flex_row,
        Atoms.align_center,
        Atoms.rounded_full,
        Atoms.cursor_pointer,
        hovered && { opacity: 0.8 },
        pressed && { opacity: 0.6 },
      ]}
      hitSlop={16}
    >
      {/** Render our own emoji on top with full opacity, if present: */}
      {myEmoji ? (
        <View style={{ zIndex: 2 }}>
          <EmojiImage sequence={myEmoji} size={EMOJI_SIZE} />
        </View>
      ) : null}
      {others.length > 0 ? (
        /** Render other reactions dimmed, behind our own: */
        <View
          needsOffscreenAlphaCompositing
          style={[
            Atoms.flex_row,
            Atoms.align_center,
            { zIndex: 1 },
            /** Tuck under our reaction if we have one: */
            myEmoji && { marginLeft: -6 },
          ]}
        >
          {others.map((emoji, i) => (
            <View
              key={emoji}
              style={[
                { zIndex: others.length - i },
                i > 0 && { marginLeft: -6 },
              ]}
            >
              <EmojiImage sequence={emoji} size={EMOJI_SIZE} />
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  ) : null;

  return (
    <>
      {previewButton}
      {/* Render this sheet even if there are no reactions in case the user was
          viewing it when the last remaining reaction was deleted. */}
      <ReactionDetailsSheet
        post={post}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
