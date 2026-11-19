import type { Track } from '../data/track.model';
import { steppedSelectionId } from './selection-order';

function trackAt(id: string, x: number): Track {
  return { id, x, y: 5, heading: 0, speed: 0, firstSeen: 0 };
}

describe('steppedSelectionId', () => {
  const tracks = [trackAt('T-30', 30), trackAt('T-10', 10), trackAt('T-20b', 20), trackAt('T-20a', 20)];

  it('starts at the first person for next and the last for previous when nothing is selected', () => {
    expect(steppedSelectionId(tracks, null, 'next')).toBe('T-10');
    expect(steppedSelectionId(tracks, null, 'previous')).toBe('T-30');
  });

  it('steps along x, breaking ties by id', () => {
    expect(steppedSelectionId(tracks, 'T-10', 'next')).toBe('T-20a');
    expect(steppedSelectionId(tracks, 'T-20a', 'next')).toBe('T-20b');
    expect(steppedSelectionId(tracks, 'T-20b', 'previous')).toBe('T-20a');
  });

  it('wraps around at both ends', () => {
    expect(steppedSelectionId(tracks, 'T-30', 'next')).toBe('T-10');
    expect(steppedSelectionId(tracks, 'T-10', 'previous')).toBe('T-30');
  });

  it('starts over when the selected person has left', () => {
    expect(steppedSelectionId(tracks, 'T-99', 'next')).toBe('T-10');
  });

  it('selects nobody on an empty platform', () => {
    expect(steppedSelectionId([], 'T-10', 'next')).toBeNull();
  });
});
