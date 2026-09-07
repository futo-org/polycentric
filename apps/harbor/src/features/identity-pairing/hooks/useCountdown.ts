import { useEffect, useState } from 'react';

export type Countdown = {
  /**
   * The time left in seconds, or 0 if the expiration time has been reached.
   * Null when the input is null.
   */
  remainingSeconds: number | null;

  /** True only when we have an expiration time and it has passed. */
  expired: boolean;
};

const IDLE: Countdown = { remainingSeconds: null, expired: false };
const EXPIRED: Countdown = { remainingSeconds: 0, expired: true };

/** Read the countdown for `expiresAtMs` against the current time. */
function countdownAt(expiresAtMs: number | null): Countdown {
  if (expiresAtMs === null) {
    return IDLE;
  }

  const remainingMs = expiresAtMs - Date.now();
  if (remainingMs <= 0) {
    return EXPIRED;
  }

  return { remainingSeconds: Math.ceil(remainingMs / 1000), expired: false };
}

function sameCountdown(a: Countdown, b: Countdown): boolean {
  return a.remainingSeconds === b.remainingSeconds && a.expired === b.expired;
}

/** Track countdown and expiration. */
export function useCountdown(expiresAt: Date | null): Countdown {
  const expiresAtMs = expiresAt?.getTime() ?? null;

  const [countdown, setCountdown] = useState<Countdown>(() =>
    countdownAt(expiresAtMs),
  );

  useEffect(() => {
    /** Update the countdown state and return whether we are done. */
    const sync = () => {
      const next = countdownAt(expiresAtMs);
      setCountdown((prev) => (sameCountdown(prev, next) ? prev : next));
      return next.expired || next.remainingSeconds === null;
    };

    // Update immediately on mount and when the expiration time changes.
    if (sync()) {
      return;
    }

    // Update once per second
    const interval = setInterval(() => {
      if (sync()) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAtMs]);

  return countdown;
}
