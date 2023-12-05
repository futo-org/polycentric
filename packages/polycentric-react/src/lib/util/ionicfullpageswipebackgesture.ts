import { GestureDetail, createGesture } from '@ionic/react'

// Allow swiping back anywhere on page
// The only other way to do this is to distribute our own ionic build
// Copy of
// https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/gesture/swipe-back.ts
// With one change to add x threshold value
// All changed lines have 'Polycentric:' comment above

// @ts-nocheck

const clamp = (min: number, n: number, max: number) => {
  return Math.max(min, Math.min(n, max))
}

const isRTL = (hostEl?: Pick<HTMLElement, 'dir'>) => {
  if (hostEl) {
    if (hostEl.dir !== '') {
      return hostEl.dir.toLowerCase() === 'rtl'
    }
  }
  return document?.dir.toLowerCase() === 'rtl'
}

export const createSwipeBackGesture = (
  el: HTMLElement,
  canStartHandler: () => boolean,
  onStartHandler: () => void,
  onMoveHandler: (step: number) => void,
  onEndHandler: (shouldComplete: boolean, step: number, dur: number) => void,
  threshold = 30,
) => {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const win = el.ownerDocument!.defaultView!
  let rtl = isRTL(el)

  /**
   * Determine if a gesture is near the edge
   * of the screen. If true, then the swipe
   * to go back gesture should proceed.
   */

  const isAtEdge = (detail: GestureDetail) => {
    const { startX } = detail

    if (rtl) {
      // Polycentric: this has changed
      return startX >= win.innerWidth - threshold
    }

    // Polycentric: this has changed
    return startX <= threshold
  }

  const getDeltaX = (detail: GestureDetail) => {
    return rtl ? -detail.deltaX : detail.deltaX
  }

  const getVelocityX = (detail: GestureDetail) => {
    return rtl ? -detail.velocityX : detail.velocityX
  }

  const canStart = (detail: GestureDetail) => {
    /**
     * The user's locale can change mid-session,
     * so we need to check text direction at
     * the beginning of every gesture.
     */
    rtl = isRTL(el)

    return isAtEdge(detail) && canStartHandler()
  }

  const onMove = (detail: GestureDetail) => {
    // set the transition animation's progress
    const delta = getDeltaX(detail)
    const stepValue = delta / win.innerWidth
    onMoveHandler(stepValue)
  }

  const onEnd = (detail: GestureDetail) => {
    // the swipe back gesture has ended
    const delta = getDeltaX(detail)
    const width = win.innerWidth
    const stepValue = delta / width
    const velocity = getVelocityX(detail)
    const z = width / 2.0
    const shouldComplete = velocity >= 0 && (velocity > 0.2 || delta > z)

    const missing = shouldComplete ? 1 - stepValue : stepValue
    const missingDistance = missing * width
    let realDur = 0
    if (missingDistance > 5) {
      const dur = missingDistance / Math.abs(velocity)
      realDur = Math.min(dur, 540)
    }

    onEndHandler(shouldComplete, stepValue <= 0 ? 0.01 : clamp(0, stepValue, 0.9999), realDur)
  }

  return createGesture({
    el,
    gestureName: 'goback-swipe',
    /**
     * Swipe to go back should have priority over other horizontal swipe
     * gestures. These gestures have a priority of 100 which is why 101 was chosen here.
     */
    gesturePriority: 101,
    threshold: 10,
    canStart,
    onStart: onStartHandler,
    onMove,
    onEnd,
  })
}
