import type { PlatformLayout } from '../data/platform-layout';

export interface HourBucket {
  /** Local hour of day, 0 to 23. */
  hour: number;
  /** Time-weighted average people on the platform during the hour. */
  average: number;
  peak: number;
  /** Peak went over capacity during the hour. */
  breached: boolean;
  isCurrent: boolean;
}

/** The hour still in progress, accumulated as a time-weighted sum. */
export interface CurrentHourStats {
  /** Local hour of day, 0 to 23. */
  hour: number;
  /**
   * Whole local hours since the epoch (see `localHourIndex`), so hours keep ordering across midnight.
   * Null for the seeded hour, which has no date until the first live frame pins it.
   */
  hourIndex: number | null;
  weightedSeconds: number;
  /** Sum of count × seconds at that count. */
  peopleSeconds: number;
  peak: number;
  /** Epoch ms of the last frame added; null before the first live frame. */
  lastFrameAt: number | null;
}

export interface HourlyHistory {
  /** People above which an hour counts as breached. */
  capacity: number;
  completedHours: HourBucket[];
  current: CurrentHourStats;
}

/** Earlier today, as [hour, average, peak]: a morning bank with a breach at 08:14, and an evening bank. */
const SEEDED_EARLIER_HOURS: ReadonlyArray<readonly [number, number, number]> = [
  [5, 14, 26],
  [6, 38, 66],
  [7, 72, 104],
  [8, 88, 122],
  [9, 62, 96],
  [10, 42, 70],
  [11, 35, 58],
  [12, 40, 63],
  [13, 37, 60],
  [14, 46, 75],
  [15, 67, 102],
  [16, 92, 113],
];

/** 17:00 to 17:42, before the demo clock starts: 42 minutes averaging 96 people, peak 118. */
const SEEDED_CURRENT_HOUR: CurrentHourStats = {
  hour: 17,
  hourIndex: null,
  weightedSeconds: 42 * 60,
  peopleSeconds: 42 * 60 * 96,
  peak: 118,
  lastFrameAt: null,
};

/** The history keeps the most recent 24 hours (completed ones plus the current one), so each hour of day appears once. */
export const MAX_HOURS_SHOWN = 24;

/** Frames further apart than this (a reconnect gap) count as this long. */
const MAX_FRAME_GAP_SECONDS = 1;

export function createSeededHourlyHistory(layout: PlatformLayout): HourlyHistory {
  const completedHours = SEEDED_EARLIER_HOURS.map(([hour, average, peak]) => ({
    hour,
    average,
    peak,
    breached: peak > layout.capacity,
    isCurrent: false,
  }));
  return { capacity: layout.capacity, completedHours, current: { ...SEEDED_CURRENT_HOUR } };
}

/**
 * Reducer: fold one live frame (epoch ms, people on platform) into the history.
 * Hours only move forward. A restarted track server restarts the demo clock at an earlier time;
 * its frames keep adding to the current hour instead of opening a second bucket for an hour already shown.
 */
export function addFrameToHistory(history: HourlyHistory, frame: { t: number; count: number }): HourlyHistory {
  const { capacity, completedHours, current } = history;
  const frameHourIndex = localHourIndex(frame.t);
  const currentHourIndex = current.hourIndex ?? pinToFrameDay(current.hour, frame.t);

  if (frameHourIndex > currentHourIndex) {
    const finishedHour = toHourBucket(current, capacity, false);
    const freshHour: CurrentHourStats = {
      hour: new Date(frame.t).getHours(),
      hourIndex: frameHourIndex,
      weightedSeconds: 0,
      peopleSeconds: 0,
      peak: 0,
      lastFrameAt: null,
    };
    const recentCompletedHours = [...completedHours, finishedHour].slice(-(MAX_HOURS_SHOWN - 1));
    return addFrameToHistory({ capacity, completedHours: recentCompletedHours, current: freshHour }, frame);
  }

  const rawGapSeconds = current.lastFrameAt === null ? 0 : (frame.t - current.lastFrameAt) / 1000;
  // A restarted track server restarts the demo clock, so the gap can be negative.
  const secondsSinceLastFrame = Math.min(Math.max(rawGapSeconds, 0), MAX_FRAME_GAP_SECONDS);

  return {
    capacity,
    completedHours,
    current: {
      hour: current.hour,
      hourIndex: currentHourIndex,
      weightedSeconds: current.weightedSeconds + secondsSinceLastFrame,
      peopleSeconds: current.peopleSeconds + frame.count * secondsSinceLastFrame,
      peak: Math.max(current.peak, frame.count),
      lastFrameAt: frame.t,
    },
  };
}

export function toHourBuckets(history: HourlyHistory): HourBucket[] {
  return [...history.completedHours, toHourBucket(history.current, history.capacity, true)];
}

function toHourBucket(stats: CurrentHourStats, capacity: number, isCurrent: boolean): HourBucket {
  const average = stats.weightedSeconds > 0 ? Math.round(stats.peopleSeconds / stats.weightedSeconds) : stats.peak;
  return {
    hour: stats.hour,
    average,
    peak: stats.peak,
    breached: stats.peak > capacity,
    isCurrent,
  };
}

/** Whole local hours since the epoch: one more for every hour on the local clock, across midnight too. */
export function localHourIndex(epochMs: number): number {
  const offsetMs = new Date(epochMs).getTimezoneOffset() * 60_000;
  return Math.floor((epochMs - offsetMs) / 3_600_000);
}

/** The hour index of `hourOfDay` on the same local day as `epochMs`. */
function pinToFrameDay(hourOfDay: number, epochMs: number): number {
  return localHourIndex(epochMs) - (new Date(epochMs).getHours() - hourOfDay);
}
