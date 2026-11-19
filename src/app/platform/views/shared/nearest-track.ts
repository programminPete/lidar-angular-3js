/** A person's position on screen, in CSS pixels, after the view's projection. */
export interface ScreenPoint {
  id: string;
  x: number;
  y: number;
}

/** The id of the point nearest the click, if it lies within `maxDistancePx` (inclusive); otherwise null. */
export function nearestTrackId(
  points: Iterable<ScreenPoint>,
  click: { x: number; y: number },
  maxDistancePx: number,
): string | null {
  let nearestId: string | null = null;
  let nearestDistance = maxDistancePx;
  for (const point of points) {
    const distance = Math.hypot(point.x - click.x, point.y - click.y);
    if (distance <= nearestDistance) {
      nearestId = point.id;
      nearestDistance = distance;
    }
  }
  return nearestId;
}
