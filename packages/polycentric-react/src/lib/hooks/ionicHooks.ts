// React component that when created, will create an ionic gesture with high priority
// Such that it won't allow any other gestures to be recognized

import { GestureDetail } from '@ionic/core'
import { createGesture } from '@ionic/react'
import { useLayoutEffect } from 'react'

export const useGestureWall = (enabled = true) => {
  useLayoutEffect(() => {
    if (enabled) {
      const g = createGesture({
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        el: document,
        gestureName: 'gesture-wall',
        gesturePriority: 10000,
        onMove: (e: GestureDetail) => {
          e.event.preventDefault()
        },
      })
      g.enable()

      return () => {
        g?.destroy()
      }
    }
  }, [enabled])
}
