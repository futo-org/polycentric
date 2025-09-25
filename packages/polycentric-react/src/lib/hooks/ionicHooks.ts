/**
 * @fileoverview Ionic gesture management with high-priority gesture blocking.
 *
 * Key Design Decisions:
 * - High-priority gesture (priority 10000) to block all other gestures
 * - Selective blocking that allows input elements and scrollable areas to function
 * - Gesture wall prevents unwanted touch interactions during modal/overlay states
 * - Automatic cleanup to prevent memory leaks and gesture conflicts
 */

import { GestureDetail } from '@ionic/core';
import { createGesture } from '@ionic/react';
import { useLayoutEffect } from 'react';

// High-priority gesture wall that blocks all gestures except input and scrollable elements
export const useGestureWall = (enabled = true) => {
  useLayoutEffect(() => {
    if (enabled) {
      const g = createGesture({
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        el: document,
        gestureName: 'gesture-wall',
        gesturePriority: 10000,
        onMove: (e: GestureDetail) => {
          const target = e.event.target as HTMLElement | null;

          if (target?.closest('textarea, input, [data-scrollable]')) {
            return;
          }

          e.event.preventDefault();
        },
      });
      g.enable();

      return () => {
        g?.destroy();
      };
    }
  }, [enabled]);
};
