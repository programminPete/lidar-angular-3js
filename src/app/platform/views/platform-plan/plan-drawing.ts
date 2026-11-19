import type { PlatformDoor, PlatformLayout, Point, Rect, ShuttleCar } from '../../data/platform-layout';
import type { ScreenBox } from '../shared/screen-box';
import { toScreenX, toScreenY, type PlanMapping } from './plan-mapping';

/**
 * Screen-space geometry for the static SVG plan, built from PLATFORM_LAYOUT and a mapping.
 * Every value is in CSS pixels, ready for the template to place.
 */

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export interface DoorDrawing {
  /** "Door 1"; drawn inside the door's keep-clear lane. */
  label: string;
  /** The thin line across the opening while the doors are shut. */
  closedLeaves: Line;
  /** The opening itself, tinted while the doors are open. */
  opening: Rect;
  /** Short ticks at both jambs while the doors are open. */
  openJambs: Line[];
  keepClear: Rect;
  labelAt: Point;
  /** Screen box the label (with its halo) covers, so the selected person's tag can stay clear of it. */
  labelBox: ScreenBox;
}

export interface EscalatorDrawing {
  outline: Rect;
  treads: Line[];
  /** The comb plate where people step off. */
  landing: Line;
  /** Points of the direction chevron, as an SVG `points` list. */
  chevron: string;
}

export interface CarDrawing {
  label: string;
  /** Shown on the empty berth while the shuttle is away. */
  berthLabel: string;
  outline: Rect;
  cornerRadius: number;
  labelAt: Point;
  /** Jamb ticks on the platform side of the car, one pair per platform door. */
  doorMarks: Line[];
}

export interface PlanDrawing {
  floor: Rect;
  /** Back and end walls plus the door wall out to the first and last door, as one path. */
  outerWall: string;
  /** Door wall pieces between neighbouring doors. */
  doorWallPieces: Rect[];
  /** Guideway edges beyond the door wall; they run past the platform ends and fade out. */
  guideway: Line[];
  guidewayFade: { x1: number; x2: number };
  doors: DoorDrawing[];
  escalators: EscalatorDrawing[];
  concourseLabelAt: Point;
  columns: Circle[];
  benches: Rect[];
  cars: CarDrawing[];
  /** Width of the "5 m" scale bar. */
  scaleBarWidth: number;
}

// World measurements in metres.
/** Walls are drawn inside the platform outline, leaving the narrow gap to the shuttle free for door labels. */
const WALL_THICKNESS = 0.25;
/** Gap between the cars and the far side of the guideway. */
const GUIDEWAY_FAR_GAP = 0.5;
/** How far the guideway lines run past each platform end. */
const GUIDEWAY_OVERRUN = 3;
const CAR_CORNER_RADIUS = 0.45;
const JAMB_TICK_OVERHANG = 0.2;
/** Moves a text baseline down so 12px text sits centred on a point. */
const TEXT_CENTER_OFFSET = 4;
const CAR_DOOR_MARK_DEPTH = 0.28;
const TREAD_SPACING = 1;
const TREAD_START_INSET = 1.1;
const TREAD_END_INSET = 1.6;
const LANDING_INSET = 0.3;
const CHEVRON_INSET = 0.98;
const CHEVRON_HALF_HEIGHT = 0.24;
const CHEVRON_DEPTH = 0.28;
const CONCOURSE_LABEL_GAP = 0.6;
export const SCALE_BAR_METRES = 5;
// The 11px "Door N" label's box in CSS pixels around its baseline centre: the text measures about 35 × 13 px, plus the 1.5px halo.
const DOOR_LABEL_HALF_WIDTH = 19;
const DOOR_LABEL_ASCENT = 11;
const DOOR_LABEL_DESCENT = 3;

/**
 * The area the plan must fit and centre: the platform plus the shuttle cars.
 * The guideway's far edge lies just outside it and may run into the margin.
 */
export function planWorldBounds(layout: PlatformLayout): Rect {
  const { outline } = layout;
  return { x: outline.x, y: outline.y, width: outline.width, height: carsTopY(layout) - outline.y };
}

export function buildPlanDrawing(layout: PlatformLayout, mapping: PlanMapping): PlanDrawing {
  const px = (metres: number) => metres * mapping.scale;
  const point = (x: number, y: number): Point => ({ x: toScreenX(mapping, x), y: toScreenY(mapping, y) });
  const rect = (world: Rect) => crispRect(mapping, world);
  const line = (x1: number, y1: number, x2: number, y2: number) => crispLine(mapping, x1, y1, x2, y2);

  const { outline } = layout;
  const guidewayStart = outline.x - GUIDEWAY_OVERRUN;
  const guidewayEnd = outline.x + outline.width + GUIDEWAY_OVERRUN;
  const topEscalatorY = Math.max(...layout.escalators.map((escalator) => escalator.y + escalator.height));

  return {
    floor: rect(outline),
    outerWall: outerWallPath(layout, mapping),
    doorWallPieces: doorWallPieces(layout).map(rect),
    guideway: [
      line(guidewayStart, layout.doorWallY, guidewayEnd, layout.doorWallY),
      line(guidewayStart, guidewayFarY(layout), guidewayEnd, guidewayFarY(layout)),
    ],
    guidewayFade: { x1: toScreenX(mapping, guidewayStart), x2: toScreenX(mapping, guidewayEnd) },
    doors: layout.doors.map((door) => doorDrawing(door, layout, mapping)),
    escalators: layout.escalators.map((escalator) => escalatorDrawing(escalator, mapping)),
    concourseLabelAt: point(layout.escalators[0].x, topEscalatorY + CONCOURSE_LABEL_GAP),
    columns: layout.columns.map((column) => ({
      cx: toScreenX(mapping, column.center.x),
      cy: toScreenY(mapping, column.center.y),
      r: px(column.radius),
    })),
    benches: layout.benches.map(rect),
    cars: layout.shuttleCars.map((car) => carDrawing(car, layout.doors, mapping)),
    scaleBarWidth: Math.round(px(SCALE_BAR_METRES)),
  };
}

function carsTopY(layout: PlatformLayout): number {
  return Math.max(...layout.shuttleCars.map((car) => car.outline.y + car.outline.height));
}

function guidewayFarY(layout: PlatformLayout): number {
  return carsTopY(layout) + GUIDEWAY_FAR_GAP;
}

function doorLeftX(door: PlatformDoor): number {
  return door.center.x - door.width / 2;
}

function doorRightX(door: PlatformDoor): number {
  return door.center.x + door.width / 2;
}

/** U-shaped wall band: from Door 1's left jamb, round the back of the platform, to the last door's right jamb. */
function outerWallPath(layout: PlatformLayout, mapping: PlanMapping): string {
  const { outline, doors, doorWallY } = layout;
  const left = outline.x;
  const right = outline.x + outline.width;
  const back = outline.y;
  const innerLeft = left + WALL_THICKNESS;
  const innerRight = right - WALL_THICKNESS;
  const innerBack = back + WALL_THICKNESS;
  const innerFront = doorWallY - WALL_THICKNESS;
  const firstJamb = doorLeftX(doors[0]);
  const lastJamb = doorRightX(doors[doors.length - 1]);

  const corners: Array<[number, number]> = [
    [left, doorWallY],
    [firstJamb, doorWallY],
    [firstJamb, innerFront],
    [innerLeft, innerFront],
    [innerLeft, innerBack],
    [innerRight, innerBack],
    [innerRight, innerFront],
    [lastJamb, innerFront],
    [lastJamb, doorWallY],
    [right, doorWallY],
    [right, back],
    [left, back],
  ];
  const commands = corners.map(([x, y]) => `${crisp(toScreenX(mapping, x))},${crisp(toScreenY(mapping, y))}`);
  return `M${commands.join('L')}Z`;
}

function doorWallPieces(layout: PlatformLayout): Rect[] {
  const { doors, doorWallY } = layout;
  return doors.slice(1).map((door, index) => {
    const start = doorRightX(doors[index]);
    return { x: start, y: doorWallY - WALL_THICKNESS, width: doorLeftX(door) - start, height: WALL_THICKNESS };
  });
}

function doorDrawing(door: PlatformDoor, layout: PlatformLayout, mapping: PlanMapping): DoorDrawing {
  const wallY = layout.doorWallY;
  const wallInnerY = wallY - WALL_THICKNESS;
  const left = doorLeftX(door);
  const right = doorRightX(door);
  const tickBottom = wallInnerY - JAMB_TICK_OVERHANG;
  const tickTop = wallY + JAMB_TICK_OVERHANG;
  const keepClear = crispRect(mapping, door.keepClear);
  const labelAt = { x: toScreenX(mapping, door.center.x), y: keepClear.y + keepClear.height - 8 };

  return {
    label: door.label,
    closedLeaves: crispLine(mapping, left, wallY - WALL_THICKNESS / 2, right, wallY - WALL_THICKNESS / 2),
    opening: crispRect(mapping, { x: left, y: wallInnerY, width: door.width, height: WALL_THICKNESS }),
    openJambs: [
      crispLine(mapping, left, tickBottom, left, tickTop),
      crispLine(mapping, right, tickBottom, right, tickTop),
    ],
    keepClear,
    labelAt,
    labelBox: {
      x: labelAt.x - DOOR_LABEL_HALF_WIDTH,
      y: labelAt.y - DOOR_LABEL_ASCENT,
      width: DOOR_LABEL_HALF_WIDTH * 2,
      height: DOOR_LABEL_ASCENT + DOOR_LABEL_DESCENT,
    },
  };
}

function escalatorDrawing(escalator: Rect, mapping: PlanMapping): EscalatorDrawing {
  const bottom = escalator.y;
  const top = escalator.y + escalator.height;
  const middle = escalator.y + escalator.height / 2;
  const end = escalator.x + escalator.width;

  const treads: Line[] = [];
  for (let x = escalator.x + TREAD_START_INSET; x <= end - TREAD_END_INSET + 1e-6; x += TREAD_SPACING) {
    treads.push(crispLine(mapping, x, bottom + 0.14, x, top - 0.14));
  }

  const tipX = end - CHEVRON_INSET;
  const chevronPoints: Array<[number, number]> = [
    [tipX - CHEVRON_DEPTH, middle + CHEVRON_HALF_HEIGHT],
    [tipX, middle],
    [tipX - CHEVRON_DEPTH, middle - CHEVRON_HALF_HEIGHT],
  ];

  return {
    outline: crispRect(mapping, escalator),
    treads,
    landing: crispLine(mapping, end - LANDING_INSET, bottom, end - LANDING_INSET, top),
    chevron: chevronPoints.map(([x, y]) => `${toScreenX(mapping, x)},${toScreenY(mapping, y)}`).join(' '),
  };
}

function carDrawing(car: ShuttleCar, doors: readonly PlatformDoor[], mapping: PlanMapping): CarDrawing {
  const { outline } = car;
  const doorsAlongCar = doors.filter(
    (door) => door.center.x > outline.x && door.center.x < outline.x + outline.width,
  );
  const markTop = outline.y + CAR_DOOR_MARK_DEPTH;
  const doorMarks = doorsAlongCar.flatMap((door) => [
    crispLine(mapping, doorLeftX(door), outline.y, doorLeftX(door), markTop),
    crispLine(mapping, doorRightX(door), outline.y, doorRightX(door), markTop),
  ]);

  return {
    label: car.label,
    berthLabel: `Berth · ${car.label}`,
    outline: crispRect(mapping, outline),
    cornerRadius: CAR_CORNER_RADIUS * mapping.scale,
    labelAt: {
      x: toScreenX(mapping, outline.x + outline.width / 2),
      y: toScreenY(mapping, outline.y + outline.height / 2) + TEXT_CENTER_OFFSET,
    },
    doorMarks,
  };
}

/** Puts a coordinate on a pixel centre so 1px strokes render as one sharp pixel. */
function crisp(value: number): number {
  return Math.round(value - 0.5) + 0.5;
}

function crispRect(mapping: PlanMapping, world: Rect): Rect {
  const left = crisp(toScreenX(mapping, world.x));
  const right = crisp(toScreenX(mapping, world.x + world.width));
  const top = crisp(toScreenY(mapping, world.y + world.height));
  const bottom = crisp(toScreenY(mapping, world.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function crispLine(mapping: PlanMapping, x1: number, y1: number, x2: number, y2: number): Line {
  return {
    x1: crisp(toScreenX(mapping, x1)),
    y1: crisp(toScreenY(mapping, y1)),
    x2: crisp(toScreenX(mapping, x2)),
    y2: crisp(toScreenY(mapping, y2)),
  };
}
