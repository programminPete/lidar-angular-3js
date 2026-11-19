import type { ShuttleStatus, Track } from '../data/track.model';
import { PLATFORM_LAYOUT } from '../data/platform-layout';
import { computePlatformMetrics, joinDoorIds, quietDoorIds } from './platform-metrics';

const DOORS_CLOSED: ShuttleStatus = { phase: 'approaching', arrivesInSeconds: 60, doorsOpen: false, spaceFor: 120 };
const DOORS_OPEN: ShuttleStatus = { phase: 'docked', arrivesInSeconds: 0, doorsOpen: true, spaceFor: 120 };

function trackAt(id: string, x: number, y: number, speed = 0): Track {
  return { id, x, y, heading: 0, speed, firstSeen: 0 };
}

/** `count` tracks standing well back from a door, outside its keep-clear lane. */
function crowdNearDoor(doorId: number, count: number): Track[] {
  const door = PLATFORM_LAYOUT.doors[doorId - 1];
  return Array.from({ length: count }, (_, index) => trackAt(`D${doorId}-${index}`, door.center.x, 6));
}

describe('computePlatformMetrics', () => {
  it('counts only tracks inside the platform outline', () => {
    const tracks = [trackAt('in', 10, 5), trackAt('beyond-door-wall', 10, 14), trackAt('behind-back-wall', 10, -1)];

    const metrics = computePlatformMetrics(tracks, DOORS_CLOSED, PLATFORM_LAYOUT);

    expect(metrics.totalCount).toBe(1);
  });

  it('reports percent full rounded against capacity', () => {
    const tracks = [...crowdNearDoor(1, 62), ...crowdNearDoor(2, 62)];

    const metrics = computePlatformMetrics(tracks, DOORS_CLOSED, PLATFORM_LAYOUT);

    expect(metrics.totalCount).toBe(124);
    expect(metrics.capacity).toBe(120);
    expect(metrics.percentFull).toBe(103);
  });

  it('assigns each track to its nearest door and flags doors above even share', () => {
    const tracks = [...crowdNearDoor(1, 46), ...crowdNearDoor(2, 41), ...crowdNearDoor(3, 24), ...crowdNearDoor(4, 13)];

    const metrics = computePlatformMetrics(tracks, DOORS_CLOSED, PLATFORM_LAYOUT);

    expect(metrics.waitingByDoor.map((door) => door.count)).toEqual([46, 41, 24, 13]);
    expect(metrics.waitingByDoor.map((door) => door.aboveEvenShare)).toEqual([true, true, false, false]);
    expect(metrics.evenShare).toBe(31);
  });

  it('sums the room left at doors below even share', () => {
    const tracks = [...crowdNearDoor(1, 46), ...crowdNearDoor(2, 41), ...crowdNearDoor(3, 24), ...crowdNearDoor(4, 13)];

    const metrics = computePlatformMetrics(tracks, DOORS_CLOSED, PLATFORM_LAYOUT);

    // (31 - 24) + (31 - 13)
    expect(metrics.roomAtQuietDoors).toBe(25);
    expect(quietDoorIds(metrics)).toEqual([3, 4]);
  });

  describe('keep-clear lanes', () => {
    const doorTwoLane = PLATFORM_LAYOUT.doors[1].keepClear;
    const tracks = [
      trackAt('standing-in-lane', doorTwoLane.x + 1, doorTwoLane.y + 1, 0.05),
      trackAt('walking-through-lane', doorTwoLane.x + 1.5, doorTwoLane.y + 2, 1.1),
      trackAt('beside-lane', doorTwoLane.x - 0.5, doorTwoLane.y + 1, 0.05),
    ];

    it('lists only people standing in a lane while the doors are closed', () => {
      const metrics = computePlatformMetrics(tracks, DOORS_CLOSED, PLATFORM_LAYOUT);

      expect([...metrics.keepClearTrackIds]).toEqual(['standing-in-lane']);
    });

    it('lists nobody while the doors are open, because people cross lanes to board', () => {
      const metrics = computePlatformMetrics(tracks, DOORS_OPEN, PLATFORM_LAYOUT);

      expect(metrics.keepClearTrackIds.size).toBe(0);
    });
  });

  it('handles an empty platform', () => {
    const metrics = computePlatformMetrics([], null, PLATFORM_LAYOUT);

    expect(metrics.totalCount).toBe(0);
    expect(metrics.percentFull).toBe(0);
    expect(metrics.roomAtQuietDoors).toBe(0);
    expect(quietDoorIds(metrics)).toEqual([]);
  });
});

describe('joinDoorIds', () => {
  it('writes door lists the way a person would say them', () => {
    expect(joinDoorIds([4])).toBe('4');
    expect(joinDoorIds([3, 4])).toBe('3 and 4');
    expect(joinDoorIds([2, 3, 4])).toBe('2, 3 and 4');
  });
});
