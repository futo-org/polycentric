/**
 * @fileoverview React Context definitions. Separated for HMR support.
 */

import { createContext, Dispatch, SetStateAction } from 'react';
import { StackRouterContextType } from '../hooks/stackRouterHooks';

// Navigation stack management with error-throwing defaults to ensure provider usage
export const StackRouterContext = createContext<StackRouterContextType>({
  history: [],
  currentPath: '',
  index: -69,
  push: () => {
    console.error('Impossible');
  },
  pop: () => {
    console.error('Impossible');
  },
  setRoot: () => {
    console.error('Impossible');
  },
  popN: () => {
    console.error('Impossible');
  },
  getIonicStackHeight: () => {
    console.error('Impossible');
    return 0;
  },
  canGoBack: () => {
    console.error('Impossible');
    return false;
  },
});

// Mobile swipe navigation topic state
export const MobileSwipeTopicContext = createContext<{
  topic: string;
  setTopic: (topic: string) => void;
}>({ topic: 'Explore', setTopic: () => {} });

// Content moderation settings and tag visibility
export const ModerationContext = createContext<{
  moderationLevels: Record<string, number> | undefined;
  setModerationLevels: Dispatch<
    SetStateAction<Record<string, number> | undefined>
  >;
  showModerationTags: boolean;
  setShowModerationTags: Dispatch<SetStateAction<boolean>>;
}>({
  moderationLevels: undefined,
  setModerationLevels: () => undefined,
  showModerationTags: false,
  setShowModerationTags: () => undefined,
});
