import { useContext } from 'react';

import { ModerationContext } from '../app/contexts';

export function useModeration() {
  const {
    moderationLevels,
    setModerationLevels,
    showModerationTags,
    setShowModerationTags,
  } = useContext(ModerationContext);

  return {
    moderationLevels,
    setModerationLevels,
    showModerationTags,
    setShowModerationTags,
  };
}
