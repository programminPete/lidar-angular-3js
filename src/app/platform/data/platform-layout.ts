/**
 * Site configuration for the Airside C shuttle platform. Both viewports and the simulator draw from it.
 *
 * Platform frame, used everywhere in this app:
 * metres; origin at the platform's back-wall corner on the escalator end;
 * +x runs along the platform from the escalators (x = 0) toward Door 4 (x = 38);
 * +y runs from the back wall (y = 0) to the door wall (y = 13).
 * The shuttle berths beyond the door wall (y > 13). Headings are radians from +x toward +y.
 * In a plan view drawn with +y up, the door wall is the top edge and the escalators are on the left.
 */

export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned rectangle; (x, y) is the corner with the smallest coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlatformDoor {
  /** 1 to 4; Door 1 is nearest the escalators. */
  id: number;
  label: string;
  /** Centre of the door opening, on the door wall. */
  center: Point;
  /** Width of the door opening along x. */
  width: number;
  /** Area in front of the door that should stay free for people leaving the shuttle. */
  keepClear: Rect;
}

export interface ShuttleCar {
  label: string;
  outline: Rect;
}

export interface Column {
  center: Point;
  radius: number;
}

export interface PlatformLayout {
  name: string;
  outline: Rect;
  /** y of the door wall (the platform edge the shuttle docks against). */
  doorWallY: number;
  /** People the platform holds comfortably. Above this a capacity breach can start. */
  capacity: number;
  doors: readonly PlatformDoor[];
  shuttleCars: readonly ShuttleCar[];
  /** Down escalators from the concourse; people step off at the +x end of each rectangle. */
  escalators: readonly Rect[];
  columns: readonly Column[];
  benches: readonly Rect[];
}

const DOOR_WALL_Y = 13;
const DOOR_WIDTH = 2;
const KEEP_CLEAR_WIDTH = 2.4;
const KEEP_CLEAR_DEPTH = 3;

function door(id: number, centerX: number): PlatformDoor {
  return {
    id,
    label: `Door ${id}`,
    center: { x: centerX, y: DOOR_WALL_Y },
    width: DOOR_WIDTH,
    keepClear: {
      x: centerX - KEEP_CLEAR_WIDTH / 2,
      y: DOOR_WALL_Y - KEEP_CLEAR_DEPTH,
      width: KEEP_CLEAR_WIDTH,
      height: KEEP_CLEAR_DEPTH,
    },
  };
}

export const PLATFORM_LAYOUT: PlatformLayout = {
  name: 'Airside C shuttle lobby',
  outline: { x: 0, y: 0, width: 38, height: DOOR_WALL_Y },
  doorWallY: DOOR_WALL_Y,
  capacity: 120,
  doors: [door(1, 12.5), door(2, 18.5), door(3, 25.5), door(4, 31.5)],
  shuttleCars: [
    { label: 'Car 1', outline: { x: 9.5, y: 13.6, width: 12, height: 2.8 } },
    { label: 'Car 2', outline: { x: 22.5, y: 13.6, width: 12, height: 2.8 } },
  ],
  escalators: [
    { x: 0.6, y: 2.8, width: 7.8, height: 1.2 },
    { x: 0.6, y: 4.4, width: 7.8, height: 1.2 },
    { x: 0.6, y: 6.0, width: 7.8, height: 1.2 },
  ],
  columns: [
    { center: { x: 15.5, y: 4.2 }, radius: 0.35 },
    { center: { x: 25, y: 4.2 }, radius: 0.35 },
    { center: { x: 34.5, y: 4.2 }, radius: 0.35 },
  ],
  benches: [
    { x: 19, y: 0.5, width: 3.6, height: 0.6 },
    { x: 28.5, y: 0.5, width: 3.6, height: 0.6 },
  ],
};

export function isInsideRect(point: Point, rect: Rect, padding = 0): boolean {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding
  );
}
