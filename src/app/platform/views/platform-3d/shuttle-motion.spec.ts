import type { ShuttleStatus } from '../../data/track.model';
import { SHUTTLE_SLIDE_METRES, ShuttleMotion, easeTowards, shuttleOffsetMetres, shuttleOpacity } from './shuttle-motion';

function status(phase: ShuttleStatus['phase'], arrivesInSeconds = 0): ShuttleStatus {
  return { phase, arrivesInSeconds, doorsOpen: phase === 'docked', spaceFor: 120 };
}

describe('shuttle motion', () => {
  it('is out of view with no status or while still far off', () => {
    expect(shuttleOffsetMetres(null, 0)).toBeNull();
    expect(shuttleOffsetMetres(status('approaching', 30), 0)).toBeNull();
  });

  it('sits at its berth while docked', () => {
    expect(shuttleOffsetMetres(status('docked'), 0)).toBe(0);
  });

  it('slides in from the escalator end in the last seconds of approaching', () => {
    const farther = shuttleOffsetMetres(status('approaching', 4), 0)!;
    const nearer = shuttleOffsetMetres(status('approaching', 1), 0)!;
    expect(farther).toBe(-SHUTTLE_SLIDE_METRES);
    expect(nearer).toBeLessThan(0);
    expect(nearer).toBeGreaterThan(farther);
  });

  it('slides out toward Door 4 while departing', () => {
    expect(shuttleOffsetMetres(status('departing'), 0)).toBe(0);
    expect(shuttleOffsetMetres(status('departing'), 5)).toBe(SHUTTLE_SLIDE_METRES);
  });

  it('fades with distance from the berth', () => {
    expect(shuttleOpacity(0)).toBe(1);
    expect(shuttleOpacity(SHUTTLE_SLIDE_METRES / 2)).toBeCloseTo(0.5);
    expect(shuttleOpacity(-SHUTTLE_SLIDE_METRES)).toBe(0);
  });
});

describe('ShuttleMotion', () => {
  it('eases toward the target without overshooting', () => {
    const halfway = easeTowards(0, 10, 0.35 * Math.LN2, 0.35);
    expect(halfway).toBeCloseTo(5);
    expect(easeTowards(0, 10, 100, 0.35)).toBeCloseTo(10);
  });

  it('is fully shown at the berth while docked and hidden while far off', () => {
    const motion = new ShuttleMotion();
    motion.update(status('docked'), 0, 0.016);
    expect(motion.offsetMetres).toBe(0);
    expect(motion.opacity).toBe(1);

    motion.update(status('approaching', 90), 1000, 0.016);
    expect(motion.opacity).toBe(0);
  });

  it('measures departure on the demo clock', () => {
    const motion = new ShuttleMotion();
    motion.update(status('departing'), 10_000, 0.016);
    motion.update(status('departing'), 15_000, 100);
    expect(motion.offsetMetres).toBeCloseTo(SHUTTLE_SLIDE_METRES);
  });
});
