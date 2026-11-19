import type { ShuttleStatus, Track } from '../data/track.model';
import { isInsideRect, type PlatformLayout, type Point } from '../data/platform-layout';

export interface DoorCount {
  doorId: number;
  label: string;
  count: number;
  aboveEvenShare: boolean;
}

export interface PlatformMetrics {
  /** Tracks inside the platform outline. */
  totalCount: number;
  capacity: number;
  /** Rounded percent of capacity; can exceed 100. */
  percentFull: number;
  /** Each counted track is assigned to its nearest door. */
  waitingByDoor: DoorCount[];
  /** totalCount divided evenly across the doors (not rounded). */
  evenShare: number;
  /** Rounded sum, over doors below even share, of how far each is below it. */
  roomAtQuietDoors: number;
  /** People standing in a keep-clear lane while the shuttle doors are closed. Empty while doors are open. */
  keepClearTrackIds: ReadonlySet<string>;
}

/** At or above this percent full the platform counts as crowded: orange status, door advice shown. */
export const CROWDED_PERCENT = 90;

/** Below this speed (m/s) a person in a lane counts as standing there, not walking through. */
export const STANDING_SPEED_METRES_PER_SECOND = 0.3;

export function computePlatformMetrics(
  tracks: readonly Track[],
  shuttle: ShuttleStatus | null,
  layout: PlatformLayout,
): PlatformMetrics {
  const tracksOnPlatform = tracks.filter((track) => isInsideRect(track, layout.outline));
  const totalCount = tracksOnPlatform.length;
  const evenShare = totalCount / layout.doors.length;

  const countsByDoorId = countTracksByNearestDoor(tracksOnPlatform, layout);
  const waitingByDoor = layout.doors.map((door) => {
    const count = countsByDoorId.get(door.id) ?? 0;
    return { doorId: door.id, label: door.label, count, aboveEvenShare: count > evenShare };
  });

  const shortfallAtQuietDoors = waitingByDoor
    .filter((door) => door.count < evenShare)
    .reduce((sum, door) => sum + (evenShare - door.count), 0);

  return {
    totalCount,
    capacity: layout.capacity,
    percentFull: Math.round((totalCount / layout.capacity) * 100),
    waitingByDoor,
    evenShare,
    roomAtQuietDoors: Math.round(shortfallAtQuietDoors),
    keepClearTrackIds: findKeepClearTrackIds(tracksOnPlatform, shuttle, layout),
  };
}

/** Door ids whose count is below even share: where staff can direct people. */
export function quietDoorIds(metrics: PlatformMetrics): number[] {
  return metrics.waitingByDoor
    .filter((door) => door.count < metrics.evenShare)
    .map((door) => door.doorId);
}

/** [3, 4] → "3 and 4"; [2, 3, 4] → "2, 3 and 4". */
export function joinDoorIds(doorIds: readonly number[]): string {
  if (doorIds.length <= 1) {
    return doorIds.join('');
  }
  const allButLast = doorIds.slice(0, -1).join(', ');
  const last = doorIds[doorIds.length - 1];
  return `${allButLast} and ${last}`;
}

function countTracksByNearestDoor(tracks: readonly Track[], layout: PlatformLayout): Map<number, number> {
  const counts = new Map<number, number>();
  for (const track of tracks) {
    const doorId = nearestDoorId(track, layout);
    counts.set(doorId, (counts.get(doorId) ?? 0) + 1);
  }
  return counts;
}

/** Id of the door nearest a point in the platform frame. */
export function nearestDoorId(point: Point, layout: PlatformLayout): number {
  let nearest = layout.doors[0];
  for (const door of layout.doors) {
    const distanceToDoor = Math.hypot(point.x - door.center.x, point.y - door.center.y);
    const distanceToNearest = Math.hypot(point.x - nearest.center.x, point.y - nearest.center.y);
    if (distanceToDoor < distanceToNearest) {
      nearest = door;
    }
  }
  return nearest.id;
}

/** Walking through a lane to board is expected, so only people standing in one while doors are closed count. */
function findKeepClearTrackIds(
  tracks: readonly Track[],
  shuttle: ShuttleStatus | null,
  layout: PlatformLayout,
): ReadonlySet<string> {
  const doorsOpen = shuttle?.doorsOpen ?? false;
  if (doorsOpen) {
    return new Set();
  }
  const standingInALane = tracks.filter(
    (track) =>
      track.speed < STANDING_SPEED_METRES_PER_SECOND &&
      layout.doors.some((door) => isInsideRect(track, door.keepClear)),
  );
  return new Set(standingInALane.map((track) => track.id));
}
