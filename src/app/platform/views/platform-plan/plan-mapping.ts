import type { Point, Rect } from '../../data/platform-layout';
import type { ScreenPoint } from '../shared/nearest-track';

/**
 * Maps the platform frame (metres, +y toward the door wall) to the plan's screen space
 * (CSS pixels from the panel's top-left corner, +y down). The y axis is flipped so the
 * door wall is the top edge of the drawing.
 */
export interface PlanMapping {
  /** CSS pixels per metre. */
  scale: number;
  /** Screen x of world x = 0. */
  originX: number;
  /** Screen y of world y = 0. */
  originY: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Free space, in CSS pixels, kept between the drawing and each panel edge. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Scales `world` uniformly to fit inside `viewport` less `margins`, centred in the space left over. */
export function fitWorldToViewport(world: Rect, viewport: Size, margins: Margins): PlanMapping {
  const availableWidth = Math.max(1, viewport.width - margins.left - margins.right);
  const availableHeight = Math.max(1, viewport.height - margins.top - margins.bottom);
  const scale = Math.min(availableWidth / world.width, availableHeight / world.height);

  const drawingLeft = margins.left + (availableWidth - world.width * scale) / 2;
  const drawingTop = margins.top + (availableHeight - world.height * scale) / 2;
  const worldTop = world.y + world.height;

  return {
    scale,
    originX: drawingLeft - world.x * scale,
    originY: drawingTop + worldTop * scale,
  };
}

export function toScreenX(mapping: PlanMapping, x: number): number {
  return mapping.originX + x * mapping.scale;
}

export function toScreenY(mapping: PlanMapping, y: number): number {
  return mapping.originY - y * mapping.scale;
}

/**
 * Screen velocity, in CSS pixels per second, of someone walking at `speed` (m/s) on `heading`
 * (radians from +x toward +y). Written into `out` so render loops do not allocate.
 */
export function toScreenVelocity(mapping: PlanMapping, heading: number, speed: number, out: Point): Point {
  const pixelsPerSecond = speed * mapping.scale;
  out.x = Math.cos(heading) * pixelsPerSecond;
  // Screen y points down, so the world heading's y component flips sign.
  out.y = -Math.sin(heading) * pixelsPerSecond;
  return out;
}

/**
 * Projects people (metres) to screen points (CSS pixels), reusing the point objects in `pool` and
 * growing it as needed. Returns how many of the pool's points are current.
 */
export function projectPeople(
  mapping: PlanMapping,
  people: readonly { id: string; x: number; y: number }[],
  pool: ScreenPoint[],
): number {
  for (let index = 0; index < people.length; index++) {
    const person = people[index];
    const point = pool[index] ?? (pool[index] = { id: '', x: 0, y: 0 });
    point.id = person.id;
    point.x = toScreenX(mapping, person.x);
    point.y = toScreenY(mapping, person.y);
  }
  return people.length;
}
