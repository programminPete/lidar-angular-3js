import { PLATFORM_LAYOUT } from '../platform-layout';
import { DEMO_CLOCK_START, PlatformSimulator } from './platform-simulator';

const FRAME_SECONDS = 0.1;

describe('PlatformSimulator', () => {
  it('replays the same crowd for the same seed', () => {
    const first = new PlatformSimulator(7).step(FRAME_SECONDS);
    const second = new PlatformSimulator(7).step(FRAME_SECONDS);

    expect(second).toEqual(first);
  });

  it('starts at 17:42 with about a hundred people already waiting', () => {
    const frame = new PlatformSimulator(20261117).step(FRAME_SECONDS);

    expect(frame.t - DEMO_CLOCK_START).toBeLessThan(1000);
    expect(frame.tracks.length).toBeGreaterThan(85);
    expect(frame.tracks.length).toBeLessThan(115);
    expect(frame.tracks[0].id).toMatch(/^T-\d{4,}$/);
  });

  it('goes over capacity within 30 seconds and the shuttle docks within 70', () => {
    const simulator = new PlatformSimulator(20261117);
    let firstOverCapacitySecond: number | null = null;
    let firstDockedSecond: number | null = null;

    for (let step = 1; step <= 700; step++) {
      const frame = simulator.step(FRAME_SECONDS);
      const seconds = step * FRAME_SECONDS;
      if (firstOverCapacitySecond === null && frame.tracks.length > PLATFORM_LAYOUT.capacity) {
        firstOverCapacitySecond = seconds;
      }
      if (firstDockedSecond === null && frame.shuttle.phase === 'docked') {
        firstDockedSecond = seconds;
        expect(frame.shuttle.doorsOpen).toBe(true);
      }
    }

    expect(firstOverCapacitySecond).not.toBeNull();
    expect(firstOverCapacitySecond!).toBeLessThan(30);
    expect(firstDockedSecond).not.toBeNull();
    expect(firstDockedSecond!).toBeLessThan(70);
  });

  it('keeps every track on the platform floor', () => {
    const simulator = new PlatformSimulator(3);
    const outline = PLATFORM_LAYOUT.outline;

    for (let step = 0; step < 300; step++) {
      for (const track of simulator.step(FRAME_SECONDS).tracks) {
        expect(track.x).toBeGreaterThanOrEqual(outline.x);
        expect(track.x).toBeLessThanOrEqual(outline.x + outline.width);
        expect(track.y).toBeGreaterThanOrEqual(outline.y);
        expect(track.y).toBeLessThanOrEqual(outline.y + outline.height);
      }
    }
  });
});
