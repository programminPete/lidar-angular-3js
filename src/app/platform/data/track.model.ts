/**
 * One anonymous tracked person.
 * Positions are metres in the platform frame defined in `platform-layout.ts`
 * (origin at the escalator end of the back wall, +x toward Door 4, +y toward the door wall).
 * `heading` is radians from +x toward +y; `speed` is metres per second.
 * `firstSeen` is epoch ms on the demo clock.
 */
export interface Track {
  id: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  firstSeen: number;
}

/** Frames arrive about every 100 ms (10 Hz), from the simulator and from the track server. */
export const FRAME_INTERVAL_MS = 100;

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export type ShuttlePhase = 'approaching' | 'docked' | 'departing';

export interface ShuttleStatus {
  phase: ShuttlePhase;
  /** Whole seconds until the shuttle docks; 0 unless approaching. */
  arrivesInSeconds: number;
  doorsOpen: boolean;
  /** Free passenger places on the shuttle. */
  spaceFor: number;
}

export interface TrackFrame {
  /** Epoch ms on the demo clock. */
  t: number;
  tracks: Track[];
  shuttle: ShuttleStatus;
}
