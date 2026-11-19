import { nearestTrackId, type ScreenPoint } from './nearest-track';

describe('nearestTrackId', () => {
  const points: ScreenPoint[] = [
    { id: 'T-1', x: 100, y: 100 },
    { id: 'T-2', x: 110, y: 100 },
    { id: 'T-3', x: 300, y: 300 },
  ];

  it('returns the closest point to the click', () => {
    expect(nearestTrackId(points, { x: 107, y: 101 }, 12)).toBe('T-2');
  });

  it('includes a point exactly at the radius', () => {
    expect(nearestTrackId(points, { x: 300, y: 312 }, 12)).toBe('T-3');
  });

  it('returns null when nothing is within the radius', () => {
    expect(nearestTrackId(points, { x: 200, y: 200 }, 12)).toBeNull();
    expect(nearestTrackId([], { x: 0, y: 0 }, 12)).toBeNull();
  });
});
