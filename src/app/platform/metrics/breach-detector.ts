/** Over capacity for this long (demo clock) before a breach becomes active. */
export const BREACH_CONFIRM_MS = 5000;

/** At or under capacity for this long before a breach ends, so a wobble around capacity stays one breach. */
export const BREACH_CLEAR_MS = 3000;

/** One breach was already logged today, at 08:14, before the demo starts. */
export const BREACHES_BEFORE_DEMO = 1;

/**
 * none     at or under capacity
 * pending  over capacity, not yet for BREACH_CONFIRM_MS
 * active   a confirmed breach: over capacity now
 * clearing back at or under capacity, held for BREACH_CLEAR_MS before the breach ends;
 *          going over again returns to active with the original start time
 */
export type BreachPhase = 'none' | 'pending' | 'active' | 'clearing';

export interface BreachState {
  phase: BreachPhase;
  /** Epoch ms when the count went over capacity; null in phase none. */
  startedAt: number | null;
  /**
   * Whole seconds since startedAt, including short dips to capacity that did not end the breach.
   * Frozen while clearing, at the moment the count came back.
   */
  durationSeconds: number;
  /** Epoch ms when the count came back to capacity or below; set only while clearing. */
  clearingSince: number | null;
  acknowledged: boolean;
  breachesToday: number;
  /** Epoch ms of the last frame seen; null before the first. */
  lastFrameAt: number | null;
}

export type BreachEvent =
  | { kind: 'frame'; t: number; count: number; capacity: number }
  | { kind: 'acknowledge' };

export const INITIAL_BREACH_STATE: BreachState = {
  phase: 'none',
  startedAt: null,
  durationSeconds: 0,
  clearingSince: null,
  acknowledged: false,
  breachesToday: BREACHES_BEFORE_DEMO,
  lastFrameAt: null,
};

/** A confirmed breach the operator should see: active, or clearing but not yet over. */
export function isBreachShown(state: BreachState): boolean {
  return state.phase === 'active' || state.phase === 'clearing';
}

/** Reducer for the breach state machine; use with RxJS `scan`. */
export function nextBreachState(state: BreachState, event: BreachEvent): BreachState {
  if (event.kind === 'acknowledge') {
    return isBreachShown(state) ? { ...state, acknowledged: true } : state;
  }

  // A restarted track server restarts the demo clock; drop any breach in progress rather than
  // measuring durations across the jump.
  const clockWentBack = state.lastFrameAt !== null && event.t < state.lastFrameAt;
  const previous = clockWentBack ? noBreach(state) : state;
  const t = event.t;
  const isOverCapacity = event.count > event.capacity;
  const next = isOverCapacity ? whileOverCapacity(previous, t) : whileAtOrUnderCapacity(previous, t);
  return { ...next, lastFrameAt: t };
}

function whileOverCapacity(state: BreachState, t: number): BreachState {
  const startedAt = state.startedAt ?? t;
  const durationSeconds = secondsBetween(startedAt, t);

  switch (state.phase) {
    case 'none':
      return { ...state, phase: 'pending', startedAt, durationSeconds };
    case 'pending': {
      const isConfirmed = t - startedAt >= BREACH_CONFIRM_MS;
      if (!isConfirmed) {
        return { ...state, durationSeconds };
      }
      return {
        ...state,
        phase: 'active',
        durationSeconds,
        acknowledged: false,
        breachesToday: state.breachesToday + 1,
      };
    }
    case 'active':
    case 'clearing':
      return { ...state, phase: 'active', durationSeconds, clearingSince: null };
  }
}

function whileAtOrUnderCapacity(state: BreachState, t: number): BreachState {
  switch (state.phase) {
    case 'none':
    case 'pending':
      return noBreach(state);
    case 'active': {
      const durationSeconds = secondsBetween(state.startedAt ?? t, t);
      return { ...state, phase: 'clearing', clearingSince: t, durationSeconds };
    }
    case 'clearing': {
      const hasCleared = t - (state.clearingSince ?? t) >= BREACH_CLEAR_MS;
      return hasCleared ? noBreach(state) : state;
    }
  }
}

/** No breach active or pending; keeps the day's breach count. */
function noBreach(state: BreachState): BreachState {
  return { ...INITIAL_BREACH_STATE, breachesToday: state.breachesToday, lastFrameAt: state.lastFrameAt };
}

function secondsBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 1000);
}
