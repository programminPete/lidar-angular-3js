import type { TrackFrame } from '../data/track.model';

export type PlatformView = 'plan' | '3d';

/** The two most recent frames, for views that interpolate between 10 Hz frames at 60 fps. */
export interface FramePair {
  previous: TrackFrame;
  current: TrackFrame;
  /** performance.now() when `current` arrived. */
  receivedAt: number;
}

/** Keyboard selection steps through people in x order (along the platform). */
export type SelectionDirection = 'next' | 'previous';
