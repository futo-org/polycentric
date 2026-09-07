/** Vertical drag (px) past which releasing dismisses the viewer. */
export const CLOSE_DISTANCE = 120;
/** Vertical fling velocity (px/s) that dismisses regardless of distance. */
export const CLOSE_VELOCITY = 800;
/** Maximum pinch-zoom magnification. */
export const MAX_SCALE = 5;
/** Releasing a pinch below this scale dismisses the viewer. */
export const PINCH_CLOSE_SCALE = 0.8;
/** Horizontal fling velocity (px/s) that commits a swipe to the neighbor. */
export const SWIPE_VELOCITY = 500;
/** Drag (px) before a pan locks to horizontal (swipe) or vertical (dismiss). */
export const AXIS_LOCK_SLOP = 10;
/** Image pane height as a fraction of the viewer */
export const PANE_HEIGHT = 0.88;
/** Zoom threshold that determines double-tap zoom direction */
export const DOUBLE_TAP_ZOOM_THRESHOLD = 1.1;
