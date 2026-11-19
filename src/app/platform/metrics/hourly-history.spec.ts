import { PLATFORM_LAYOUT } from '../data/platform-layout';
import { addFrameToHistory, createSeededHourlyHistory, toHourBuckets } from './hourly-history';

/** Local time on the demo date, matching how the history reads hours. */
function localTime(hour: number, minute: number, second = 0, day = 17): number {
  return new Date(2026, 10, day, hour, minute, second).getTime();
}

describe('hourly history', () => {
  it('seeds 05:00 to 16:00 plus the current 17:00 hour', () => {
    const buckets = toHourBuckets(createSeededHourlyHistory(PLATFORM_LAYOUT));

    expect(buckets.map((bucket) => bucket.hour)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(buckets.filter((bucket) => bucket.isCurrent).map((bucket) => bucket.hour)).toEqual([17]);
  });

  it('marks only the 08:00 hour as breached in the seeded history', () => {
    const buckets = toHourBuckets(createSeededHourlyHistory(PLATFORM_LAYOUT));

    expect(buckets.filter((bucket) => bucket.breached).map((bucket) => bucket.hour)).toEqual([8]);
  });

  it('raises the current hour peak and flags a breach from live frames', () => {
    let history = createSeededHourlyHistory(PLATFORM_LAYOUT);
    history = addFrameToHistory(history, { t: localTime(17, 42, 0), count: 110 });
    history = addFrameToHistory(history, { t: localTime(17, 42, 1), count: 124 });

    const current = toHourBuckets(history).at(-1)!;
    expect(current.peak).toBe(124);
    expect(current.breached).toBe(true);
  });

  it('moves the current hour average with time-weighted live samples', () => {
    let history = createSeededHourlyHistory(PLATFORM_LAYOUT);
    const seededAverage = toHourBuckets(history).at(-1)!.average;
    for (let second = 0; second <= 600; second++) {
      history = addFrameToHistory(history, { t: localTime(17, 42) + second * 1000, count: 130 });
    }

    const liveAverage = toHourBuckets(history).at(-1)!.average;
    expect(seededAverage).toBe(96);
    // 42 minutes at 96 plus 10 minutes at 130
    expect(liveAverage).toBe(Math.round((42 * 96 + 10 * 130) / 52));
  });

  it('closes the hour and starts a new current hour when the clock passes the hour', () => {
    let history = createSeededHourlyHistory(PLATFORM_LAYOUT);
    history = addFrameToHistory(history, { t: localTime(17, 59, 59), count: 100 });
    history = addFrameToHistory(history, { t: localTime(18, 0, 0), count: 40 });

    const buckets = toHourBuckets(history);
    expect(buckets.map((bucket) => bucket.hour).slice(-2)).toEqual([17, 18]);
    expect(buckets.at(-2)!.isCurrent).toBe(false);
    expect(buckets.at(-1)).toEqual({ hour: 18, average: 40, peak: 40, breached: false, isCurrent: true });
  });

  it('keeps moving forward past midnight', () => {
    let history = createSeededHourlyHistory(PLATFORM_LAYOUT);
    history = addFrameToHistory(history, { t: localTime(17, 42, 0), count: 100 });
    history = addFrameToHistory(history, { t: localTime(23, 59, 59), count: 30 });
    history = addFrameToHistory(history, { t: localTime(0, 0, 0, 18), count: 12 });
    history = addFrameToHistory(history, { t: localTime(1, 0, 0, 18), count: 8 });

    const hours = toHourBuckets(history).map((bucket) => bucket.hour);
    expect(hours.slice(-4)).toEqual([17, 23, 0, 1]);
  });

  it('keeps one bucket per hour when the clock jumps back after a server restart', () => {
    let history = createSeededHourlyHistory(PLATFORM_LAYOUT);
    history = addFrameToHistory(history, { t: localTime(17, 59, 59), count: 100 });
    history = addFrameToHistory(history, { t: localTime(18, 5, 0), count: 60 });
    history = addFrameToHistory(history, { t: localTime(17, 42, 0), count: 125 });
    history = addFrameToHistory(history, { t: localTime(17, 42, 1), count: 125 });

    const hours = toHourBuckets(history).map((bucket) => bucket.hour);
    expect(hours.slice(-2)).toEqual([17, 18]);
    expect(new Set(hours).size).toBe(hours.length);
    expect(toHourBuckets(history).at(-1)!.peak).toBe(125);
  });

  it('uses the layout capacity for breached hours', () => {
    const smallPlatform = { ...PLATFORM_LAYOUT, capacity: 60 };
    const buckets = toHourBuckets(createSeededHourlyHistory(smallPlatform));

    expect(buckets.find((bucket) => bucket.hour === 6)!.breached).toBe(true);
  });

  it('keeps only the most recent 24 hours, so each hour of day appears once', () => {
    let history = createSeededHourlyHistory(PLATFORM_LAYOUT);
    const start = localTime(17, 42, 0);
    for (let hoursLater = 0; hoursLater <= 30; hoursLater++) {
      history = addFrameToHistory(history, { t: start + hoursLater * 3_600_000, count: 50 });
    }

    const hours = toHourBuckets(history).map((bucket) => bucket.hour);
    expect(hours.length).toBe(24);
    expect(new Set(hours).size).toBe(24);
    expect(hours.at(-1)).toBe(new Date(start + 30 * 3_600_000).getHours());
  });
});
