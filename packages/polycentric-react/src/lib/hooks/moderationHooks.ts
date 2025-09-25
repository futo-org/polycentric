/**
 * @fileoverview Content moderation hooks with level-based filtering and tag visibility.
 *
 * Key Design Decisions:
 * - Context-based moderation state management for global access
 * - Level-based content filtering with user-configurable thresholds
 * - Tag visibility controls for moderation transparency
 * - Centralized moderation settings for consistent application behavior
 */

import { useContext } from 'react';

import { ModerationContext } from '../app/contexts';

// Moderation hook with level-based filtering and tag visibility controls
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
