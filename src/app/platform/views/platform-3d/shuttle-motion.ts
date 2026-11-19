import type { ShuttleStatus } from '../../data/track.model';

/** How far along x the cars travel while sliding in or out, in metres. */
export const SHUTTLE_SLIDE_METRES = 40;
/** The cars start sliding in this many seconds before they dock. */
export const SHUTTLE_ARRIVAL_SECONDS = 4;
/** Matches the simulator's departing phase. */
export const SHUTTLE_DEPARTURE_SECONDS = 5;

/**
 * Where the cars sit along x relative to their berth, in metres, or null when they are out of view.
 * They arrive from the escalator end (negative offsets) and leave toward Door 4 (positive offsets),
 * easing in and out of the berth.
 */
export function shuttleOffsetMetres(shuttle: ShuttleStatus | null, secondsSinceDeparting: number): number | null {
  if (shuttle === null) {
    return null;
  }
  if (shuttle.phase === 'docked') {
    return 0;
  }
  if (shuttle.phase === 'departing') {
    const progress = Math.min(1, Math.max(0, secondsSinceDeparting / SHUTTLE_DEPARTURE_SECONDS));
    return SHUTTLE_SLIDE_METRES * progress * progress;
  }
  if (shuttle.arrivesInSeconds > SHUTTLE_ARRIVAL_SECONDS) {
    return null;
  }
  const remaining = shuttle.arrivesInSeconds / SHUTTLE_ARRIVAL_SECONDS;
  return -SHUTTLE_SLIDE_METRES * remaining * remaining;
}

/** Cars fade as they move away from the berth, so they never pop in or out. */
export function shuttleOpacity(offsetMetres: number): number {
  return Math.max(0, 1 - Math.abs(offsetMetres) / SHUTTLE_SLIDE_METRES);
}

/** Moves `current` toward `target` like a spring with no overshoot; `timeConstant` in seconds. */
export function easeTowards(current: number, target: number, elapsedSeconds: number, timeConstant: number): number {
  const share = 1 - Math.exp(-elapsedSeconds / timeConstant);
  return current + (target - current) * share;
}

/** Time constant for easing the cars toward where they should be; hides 1 s countdown steps. */
const SHUTTLE_SMOOTHING_SECONDS = 0.35;

/**
 * Where to draw the shuttle cars each animation frame: an offset along x and an opacity (0 when away).
 * Keeps the little state that needs: when departure started, and the eased offset.
 */
export class ShuttleMotion {
  offsetMetres = 0;
  opacity = 0;
  private departingSince: number | null = null;
  private isShown = false;

  /** `clock` is epoch ms on the demo clock; `elapsedSeconds` is real time since the last animation frame. */
  update(shuttle: ShuttleStatus | null, clock: number, elapsedSeconds: number): void {
    if (shuttle?.phase === 'departing') {
      this.departingSince ??= clock;
    } else {
      this.departingSince = null;
    }
    const secondsSinceDeparting = this.departingSince === null ? 0 : (clock - this.departingSince) / 1000;
    const target = shuttleOffsetMetres(shuttle, secondsSinceDeparting);

    if (target === null) {
      this.isShown = false;
      this.opacity = 0;
      return;
    }
    this.offsetMetres = this.isShown ? easeTowards(this.offsetMetres, target, elapsedSeconds, SHUTTLE_SMOOTHING_SECONDS) : target;
    this.isShown = true;
    this.opacity = shuttleOpacity(this.offsetMetres);
  }
}
