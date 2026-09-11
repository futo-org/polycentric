import HoverCard, { type TriggerRef } from '@/src/common/components/HoverCard';
import {
  type PostData,
  useCurrentIdentity,
  usePolycentric,
} from '@/src/common/lib/polycentric-hooks';
import { memo, useRef, useState } from 'react';
import { View } from 'react-native';
import { EmojiPickerSheet } from '../../reaction/EmojiPickerSheet';
import EmojiPickerInline from '../../reaction/EmojiPickerInline';
import useReactions from '../../reaction/useReactions';
import PostActionButton from './PostActionButton';

type PostReactionButtonProps = {
  post: PostData;
};

function PostReactionButton({ post }: PostReactionButtonProps) {
  const client = usePolycentric();
  const { hasIdentity } = useCurrentIdentity();

  const triggerRef = useRef<TriggerRef>(null);

  const reaction = useReactions((s) => s.reactions.get(post.id));
  const count = post.upvoteCount;
  const addReaction = useReactions((s) => s.addReaction);
  const removeReaction = useReactions((s) => s.removeReaction);
  const changeReaction = useReactions((s) => s.changeReaction);

  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasReaction = !!reaction;

  const onEmojiSelect = (emoji: string) => {
    triggerRef.current?.close();
    if (hasReaction && reaction.emoji === emoji) {
      // Reselecting the same emoji clears it.
      removeReaction(client, post);
    } else if (hasReaction) {
      changeReaction(client, post, { emoji, positive: true });
    } else {
      addReaction(client, post, { emoji, positive: true });
    }
  };

  const onShowMore = () => {
    triggerRef.current?.close();
    setPickerOpen(true);
  };

  const button = (
    <PostActionButton
      icon={hasReaction ? 'reaction' : 'reactionOutline'}
      emoji={reaction?.positive ? reaction.emoji : undefined}
      active={hasReaction}
      highlighted={open}
      count={count}
    />
  );

  // (Signed out)
  if (!hasIdentity) return <View>{button}</View>;

  return (
    <View style={[]}>
      <HoverCard openDelay={0} onOpenChange={setOpen}>
        <HoverCard.Trigger asChild ref={triggerRef}>
          {button}
        </HoverCard.Trigger>
        <HoverCard.Content align="start" side="top">
          <EmojiPickerInline
            selectedEmoji={reaction?.emoji}
            onSelect={onEmojiSelect}
            onShowMore={onShowMore}
          />
        </HoverCard.Content>
      </HoverCard>
      <EmojiPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(emoji) => {
          setPickerOpen(false);
          onEmojiSelect(emoji);
        }}
        selectedEmoji={reaction?.emoji}
      />
    </View>
  );
}

export default memo(PostReactionButton);
