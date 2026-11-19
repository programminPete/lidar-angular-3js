import type { Track, TrackFrame } from '../../data/track.model';
import type { FramePair } from '../../state/platform-state.model';
import { TRACK_FADE_MS, TrackMotion, blendAngle } from './track-motion';

function track(id: string, x: number, y = 5, heading = 0): Track {
  return { id, x, y, heading, speed: 1, firstSeen: 0 };
}

function frame(t: number, tracks: Track[]): TrackFrame {
  return { t, tracks, shuttle: { phase: 'approaching', arrivesInSeconds: 60, doorsOpen: false, spaceFor: 120 } };
}

function pair(previous: TrackFrame, current: TrackFrame, receivedAt: number): FramePair {
  return { previous, current, receivedAt };
}

describe('TrackMotion', () => {
  const firstFrame = frame(0, [track('T-1', 10), track('T-2', 20)]);
  const firstPair = pair(firstFrame, firstFrame, 1000);

  it('draws nothing before the first pair', () => {
    const motion = new TrackMotion();
    motion.update(null, 0);

    expect(motion.people.length).toBe(0);
  });

  it('shows people from the very first pair fully opaque', () => {
    const motion = new TrackMotion();
    motion.update(firstPair, 1000);

    expect(motion.people.map((person) => [person.id, person.opacity])).toEqual([
      ['T-1', 1],
      ['T-2', 1],
    ]);
  });

  it('blends position between the two frames over 100 ms', () => {
    const motion = new TrackMotion();
    motion.update(firstPair, 1000);
    const secondPair = pair(firstFrame, frame(100, [track('T-1', 11), track('T-2', 20)]), 1100);

    motion.update(secondPair, 1150);
    expect(motion.people[0].x).toBeCloseTo(10.5);

    motion.update(secondPair, 1300);
    expect(motion.people[0].x).toBeCloseTo(11);
  });

  it('turns heading the short way round', () => {
    expect(blendAngle(3, -3, 0.5)).toBeCloseTo(Math.PI);
    expect(blendAngle(0.1, -0.1, 0.5)).toBeCloseTo(0);
  });

  it('fades a new person in over 250 ms', () => {
    const motion = new TrackMotion();
    motion.update(firstPair, 1000);
    const withNewcomer = pair(firstFrame, frame(100, [track('T-1', 10), track('T-2', 20), track('T-3', 30)]), 1100);

    motion.update(withNewcomer, 1100);
    expect(motion.people[2].opacity).toBe(0);
    motion.update(withNewcomer, 1100 + TRACK_FADE_MS / 2);
    expect(motion.people[2].opacity).toBeCloseTo(0.5);
    motion.update(withNewcomer, 1100 + TRACK_FADE_MS);
    expect(motion.people[2].opacity).toBe(1);
  });

  it('keeps a departed person in place while fading them out, then drops them', () => {
    const motion = new TrackMotion();
    motion.update(firstPair, 1000);
    const withoutT2 = pair(firstFrame, frame(100, [track('T-1', 10)]), 1100);

    motion.update(withoutT2, 1100 + TRACK_FADE_MS / 2);
    const departed = motion.people.find((person) => person.id === 'T-2');
    expect(departed?.x).toBe(20);
    expect(departed?.opacity).toBeCloseTo(0.5);

    motion.update(withoutT2, 1100 + TRACK_FADE_MS);
    expect(motion.people.map((person) => person.id)).toEqual(['T-1']);
  });

  it('reuses the same array and person objects between animation frames', () => {
    const motion = new TrackMotion();
    motion.update(firstPair, 1000);
    const people = motion.people;
    const firstPerson = people[0];

    motion.update(pair(firstFrame, frame(100, [track('T-1', 11), track('T-2', 20)]), 1100), 1150);

    expect(motion.people).toBe(people);
    expect(motion.people[0]).toBe(firstPerson);
  });
});
