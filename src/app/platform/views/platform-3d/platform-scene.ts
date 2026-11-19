import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { SeededRandom } from '../../data/simulation/seeded-random';
import type { Column, PlatformLayout, Rect } from '../../data/platform-layout';
import { PointCloudBuilder } from './point-cloud-builder';
import { LANE_COLOR, OUTLINE_COLOR, SELECTION_COLOR, displayColor } from './point-cloud-colors';

/*
 * Static structure of the platform, built once from PLATFORM_LAYOUT.
 * Platform frame: metres, origin at the back-wall corner at the escalator end,
 * +x toward Door 4, +y toward the door wall, z up from the platform floor.
 * Details the layout does not hold (door-wall height, car height, escalator rise) are typical
 * values for a people-mover platform, chosen to match the design mock.
 */

const STRUCTURE_SEED = 20261117;

export const DOOR_WALL_HEIGHT = 2.45;
/** The door wall runs a little past the shuttle cars at each end. */
const DOOR_WALL_OVERHANG = 1;

const ESCALATOR_RISE = 4.2;
const ESCALATOR_HANDRAIL_HEIGHT = 1;
const ESCALATOR_STEP_SPACING = 0.9;
const ESCALATOR_LANDING_LENGTH = 1.2;
const UPPER_LANDING_DEPTH = 1.8;

const COLUMN_HEIGHT = 3.4;
const BENCH_SEAT_HEIGHT = 0.42;
const BENCH_BACK_HEIGHT = 0.86;

const CAR_BOTTOM_Z = -0.3;
const CAR_WINDOW_BOTTOM_Z = 0.95;
const CAR_WINDOW_TOP_Z = 2.25;
const CAR_ROOF_Z = 3.1;

/** Ceiling LiDAR sensors that the floor scan rings centre on (not part of the shared layout). */
const SCAN_SENSORS = [
  { x: 6.5, y: 10, height: 5.4 },
  { x: 15.5, y: 6.8, height: 5.4 },
  { x: 24.5, y: 6.8, height: 5.4 },
  { x: 33, y: 6.8, height: 5.4 },
];
const SCAN_RING_COUNT = 16;
const SCAN_POINTS_PER_RING = 420;
const SCAN_ALPHA = 0.09;

const POINT_MATERIAL_DEFAULTS = {
  size: 0.04,
  sizeAttenuation: true,
  vertexColors: true,
  blending: AdditiveBlending,
  transparent: true,
  depthWrite: false,
} as const;

// ---- Static structure -----------------------------------------------------------------------

export function buildStaticStructure(layout: PlatformLayout): Group {
  const random = new SeededRandom(STRUCTURE_SEED);
  const builder = new PointCloudBuilder(random);

  addFloorScanRings(builder, random, layout);
  addDoorWall(builder, layout);
  addGuideway(builder, layout);
  for (const escalator of layout.escalators) {
    addEscalator(builder, escalator);
  }
  addUpperLanding(builder, layout.escalators);
  for (const column of layout.columns) {
    addColumn(builder, random, column);
  }
  for (const bench of layout.benches) {
    addBench(builder, bench);
  }

  const group = new Group();
  group.name = 'static-structure';
  group.add(new Points(builder.toGeometry(), new PointsMaterial(POINT_MATERIAL_DEFAULTS)));
  group.add(buildPlatformOutline(layout));
  group.add(buildKeepClearLanes(layout));
  return group;
}

/**
 * Faint concentric rings on the floor around each ceiling sensor: how a spinning LiDAR sees a
 * flat floor. Inner rings are thinned so the spot under a sensor does not glow.
 */
function addFloorScanRings(builder: PointCloudBuilder, random: SeededRandom, layout: PlatformLayout): void {
  const minAngle = (10 * Math.PI) / 180;
  const maxAngle = (64 * Math.PI) / 180;
  const falloffRadius = 6.4;
  const escalatorZone = escalatorFootprint(layout.escalators);

  for (const sensor of SCAN_SENSORS) {
    for (let ring = 0; ring < SCAN_RING_COUNT; ring++) {
      const beamAngle = minAngle + ((maxAngle - minAngle) * ring) / (SCAN_RING_COUNT - 1);
      const radius = sensor.height * Math.tan(beamAngle);
      const farRingFade = 1 / (1 + Math.pow(radius / falloffRadius, 4));
      const nearRingFade = Math.min(1, Math.max(0.07, radius / 2.4));
      const keepShare = farRingFade * nearRingFade;
      const phase = random.next() * Math.PI * 2;

      for (let index = 0; index < SCAN_POINTS_PER_RING; index++) {
        if (random.next() > keepShare) {
          continue;
        }
        const angle = phase + ((index + (random.next() - 0.5) * 0.3) / SCAN_POINTS_PER_RING) * Math.PI * 2;
        const x = sensor.x + radius * Math.cos(angle);
        const y = sensor.y + radius * Math.sin(angle);
        if (isOnOpenFloor(x, y, layout.outline, escalatorZone)) {
          builder.addPoint(x, y, 0, SCAN_ALPHA * random.between(0.8, 1.2));
        }
      }
    }
  }
}

function isOnOpenFloor(x: number, y: number, outline: Rect, escalatorZone: Rect): boolean {
  const insidePlatform = x >= outline.x && x <= outline.x + outline.width && y >= outline.y && y <= outline.y + outline.height;
  const onEscalators =
    x <= escalatorZone.x + escalatorZone.width + ESCALATOR_LANDING_LENGTH &&
    y >= escalatorZone.y - 0.2 &&
    y <= escalatorZone.y + escalatorZone.height + 0.2;
  return insidePlatform && !onEscalators;
}

/** Header, sill, end posts and a post at each side of every opening; faint glass between openings. */
function addDoorWall(builder: PointCloudBuilder, layout: PlatformLayout): void {
  const wallY = layout.doorWallY;
  const { start, end } = doorWallExtent(layout);

  builder.addSegment([start, wallY, DOOR_WALL_HEIGHT], [end, wallY, DOOR_WALL_HEIGHT], { alpha: 0.42, spacing: 0.03 });
  for (const x of [start, end]) {
    builder.addSegment([x, wallY, 0], [x, wallY, DOOR_WALL_HEIGHT], { alpha: 0.4, spacing: 0.03 });
  }

  const panelEdges = [start];
  for (const door of layout.doors) {
    panelEdges.push(door.center.x - door.width / 2, door.center.x + door.width / 2);
  }
  panelEdges.push(end);

  for (let index = 0; index < panelEdges.length; index += 2) {
    const panelStart = panelEdges[index];
    const panelEnd = panelEdges[index + 1];
    builder.addWall([panelStart, wallY], [panelEnd, wallY], DOOR_WALL_HEIGHT, {
      alpha: 0.05,
      rowSpacing: 0.26,
      spacing: 0.14,
      dropout: 0.6,
    });
    builder.addSegment([panelStart, wallY, 0.03], [panelEnd, wallY, 0.03], { alpha: 0.28, spacing: 0.03 });
  }

  for (const door of layout.doors) {
    for (const side of [-1, 1]) {
      const postX = door.center.x + (side * door.width) / 2;
      builder.addSegment([postX, wallY, 0], [postX, wallY, DOOR_WALL_HEIGHT], { alpha: 0.6, spacing: 0.022 });
    }
  }
}

/** Two rails below platform level, beneath where the shuttle runs. */
function addGuideway(builder: PointCloudBuilder, layout: PlatformLayout): void {
  const { start, end } = doorWallExtent(layout);
  const firstCar = layout.shuttleCars[0].outline;
  for (const railY of [firstCar.y + 1, firstCar.y + firstCar.height - 0.8]) {
    builder.addSegment([start, railY, -1], [end, railY, -1], { alpha: 0.16, spacing: 0.06 });
  }
}

/**
 * One escalator from the concourse down to the platform. People step off at the +x end,
 * so the bottom is at x + width and the top is at x.
 */
function addEscalator(builder: PointCloudBuilder, escalator: Rect): void {
  const bottomX = escalator.x + escalator.width;
  const topX = escalator.x;
  const centerY = escalator.y + escalator.height / 2;
  const halfWidth = escalator.height / 2 - 0.08;
  const heightAt = (x: number): number => (ESCALATOR_RISE * (bottomX - x)) / (bottomX - topX);

  builder.addSurface([bottomX, centerY - halfWidth], [bottomX + ESCALATOR_LANDING_LENGTH, centerY + halfWidth], 0.02, 70, 0.14);

  const slopeLength = Math.hypot(bottomX - topX, ESCALATOR_RISE);
  const stepCount = Math.round(slopeLength / ESCALATOR_STEP_SPACING);
  for (let step = 0; step <= stepCount; step++) {
    const x = bottomX + ((topX - bottomX) * step) / stepCount;
    builder.addSegment([x, centerY - halfWidth, heightAt(x)], [x, centerY + halfWidth, heightAt(x)], { alpha: 0.12, spacing: 0.04 });
  }

  const handrail = { alpha: 0.34, spacing: 0.03 };
  for (const side of [-1, 1]) {
    const railY = centerY + side * (halfWidth + 0.07);
    const landingEndX = bottomX + ESCALATOR_LANDING_LENGTH;
    builder.addSegment([landingEndX, railY, ESCALATOR_HANDRAIL_HEIGHT], [bottomX, railY, ESCALATOR_HANDRAIL_HEIGHT], handrail);
    builder.addSegment([bottomX, railY, ESCALATOR_HANDRAIL_HEIGHT], [topX, railY, ESCALATOR_RISE + ESCALATOR_HANDRAIL_HEIGHT], handrail);
    builder.addSegment([topX, railY, ESCALATOR_RISE + ESCALATOR_HANDRAIL_HEIGHT], [topX - 0.8, railY, ESCALATOR_RISE + ESCALATOR_HANDRAIL_HEIGHT], handrail);
    builder.addSegment([bottomX + 0.6, railY, 0.02], [topX, railY, ESCALATOR_RISE + 0.02], { alpha: 0.14, spacing: 0.04 });
  }
}

/** The concourse floor edge the escalators arrive from. */
function addUpperLanding(builder: PointCloudBuilder, escalators: readonly Rect[]): void {
  const footprint = escalatorFootprint(escalators);
  const topX = footprint.x;
  const min: [number, number] = [topX - UPPER_LANDING_DEPTH, footprint.y - 0.3];
  const max: [number, number] = [topX, footprint.y + footprint.height + 0.3];
  builder.addSurface(min, max, ESCALATOR_RISE, 8, 0.2);
  builder.addBoxEdges([min[0], min[1], ESCALATOR_RISE - 0.04], [max[0], max[1], ESCALATOR_RISE], { alpha: 0.32, spacing: 0.03 });
}

/**
 * A round column as horizontal scan rings that fade with height, so it reads as rising
 * toward the ceiling rather than ending in mid-air. The ring at the floor is the clearest part.
 */
function addColumn(builder: PointCloudBuilder, random: SeededRandom, column: Column): void {
  const rowSpacing = 0.12;
  const rows = Math.round(COLUMN_HEIGHT / rowSpacing);
  const pointsPerRing = 48;

  for (let row = 0; row <= rows; row++) {
    const z = row * rowSpacing;
    const isFloorRing = row === 0;
    const fadeWithHeight = 1 - z / COLUMN_HEIGHT;
    const alpha = isFloorRing ? 0.4 : 0.14 * fadeWithHeight;
    for (let index = 0; index < pointsPerRing; index++) {
      if (!isFloorRing && random.next() < 0.25) {
        continue;
      }
      const angle = ((index + random.next()) / pointsPerRing) * Math.PI * 2;
      builder.addPoint(column.center.x + column.radius * Math.cos(angle), column.center.y + column.radius * Math.sin(angle), z, alpha);
    }
  }
}

/** A seat and a backrest along the back wall. */
function addBench(builder: PointCloudBuilder, bench: Rect): void {
  const seatMin: [number, number] = [bench.x, bench.y];
  const seatMax: [number, number] = [bench.x + bench.width, bench.y + bench.height];
  builder.addSurface(seatMin, seatMax, BENCH_SEAT_HEIGHT, 110, 0.2);
  builder.addBoxEdges([bench.x, bench.y, BENCH_SEAT_HEIGHT - 0.06], [seatMax[0], seatMax[1], BENCH_SEAT_HEIGHT], { alpha: 0.2, spacing: 0.03 });
  builder.addWall([bench.x, bench.y], [seatMax[0], bench.y], BENCH_BACK_HEIGHT - BENCH_SEAT_HEIGHT, {
    alpha: 0.14,
    baseZ: BENCH_SEAT_HEIGHT,
    rowSpacing: 0.07,
    spacing: 0.04,
    dropout: 0.2,
  });
}

function buildPlatformOutline(layout: PlatformLayout): LineLoop {
  const { x, y, width, height } = layout.outline;
  const material = new LineBasicMaterial({ color: displayColor(OUTLINE_COLOR), transparent: true, opacity: 0.16 });
  const outline = new LineLoop(floorRectangle(x, y, width, height, 0.01), material);
  outline.name = 'platform-outline';
  return outline;
}

/** Thin teal outline and a barely-there fill for each door's keep-clear lane. */
function buildKeepClearLanes(layout: PlatformLayout): Group {
  const lanes = new Group();
  lanes.name = 'keep-clear-lanes';
  const outlineMaterial = new LineBasicMaterial({ color: displayColor(LANE_COLOR), transparent: true, opacity: 0.6 });
  const fillMaterial = new MeshBasicMaterial({
    color: displayColor(LANE_COLOR),
    transparent: true,
    opacity: 0.035,
    depthWrite: false,
    side: DoubleSide,
  });

  for (const door of layout.doors) {
    const lane = door.keepClear;
    lanes.add(new LineLoop(floorRectangle(lane.x, lane.y, lane.width, lane.height, 0.015), outlineMaterial));

    const fill = new Mesh(new PlaneGeometry(lane.width, lane.height), fillMaterial);
    fill.position.set(lane.x + lane.width / 2, lane.y + lane.height / 2, 0.01);
    lanes.add(fill);
  }
  return lanes;
}

function floorRectangle(x: number, y: number, width: number, height: number, z: number): BufferGeometry {
  const corners = [x, y, z, x + width, y, z, x + width, y + height, z, x, y + height, z];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(corners, 3));
  return geometry;
}

// ---- Shuttle --------------------------------------------------------------------------------

/**
 * Both shuttle cars as one THREE.Points at their berth. The component slides the whole object
 * along x and fades its material as the shuttle arrives and leaves.
 */
export function buildShuttleCars(layout: PlatformLayout): Points<BufferGeometry, PointsMaterial> {
  const builder = new PointCloudBuilder(new SeededRandom(STRUCTURE_SEED + 1));

  for (const car of layout.shuttleCars) {
    const { x: startX, y: nearY, width: length, height: depth } = car.outline;
    const endX = startX + length;
    const farY = nearY + depth;

    builder.addSurface([startX, nearY], [endX, farY], CAR_ROOF_Z, 50, 0.16);
    builder.addBoxEdges([startX, nearY, CAR_BOTTOM_Z], [endX, farY, CAR_ROOF_Z], { alpha: 0.4, spacing: 0.025 });
    builder.addWall([startX, nearY], [endX, nearY], CAR_WINDOW_BOTTOM_Z - CAR_BOTTOM_Z, { alpha: 0.2, baseZ: CAR_BOTTOM_Z, rowSpacing: 0.13 });
    builder.addWall([startX, nearY], [endX, nearY], CAR_ROOF_Z - CAR_WINDOW_TOP_Z, { alpha: 0.22, baseZ: CAR_WINDOW_TOP_Z, rowSpacing: 0.13 });
    builder.addWall([startX, farY], [endX, farY], CAR_ROOF_Z - CAR_BOTTOM_Z, { alpha: 0.07, baseZ: CAR_BOTTOM_Z, dropout: 0.55 });
    for (const x of [startX, endX]) {
      builder.addWall([x, nearY], [x, farY], CAR_ROOF_Z - CAR_BOTTOM_Z, { alpha: 0.13, baseZ: CAR_BOTTOM_Z, dropout: 0.3 });
    }
  }

  const cars = new Points(builder.toGeometry(), new PointsMaterial(POINT_MATERIAL_DEFAULTS));
  cars.name = 'shuttle-cars';
  cars.visible = false;
  return cars;
}

/** Opacity of the berth outline while no shuttle is there. */
export const BERTH_GHOST_OPACITY = 0.18;

/**
 * The outline of both cars at their berth, drawn faintly while the shuttle is away so the
 * view keeps its shape. The component cross-fades it against the real cars.
 */
export function buildBerthGhost(layout: PlatformLayout): LineSegments<BufferGeometry, LineBasicMaterial> {
  const corners: number[] = [];
  for (const car of layout.shuttleCars) {
    const { x, y, width, height } = car.outline;
    addBoxEdgeSegments(corners, [x, y, CAR_BOTTOM_Z], [x + width, y + height, CAR_ROOF_Z]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(corners, 3));
  const material = new LineBasicMaterial({ color: displayColor(OUTLINE_COLOR), transparent: true, opacity: BERTH_GHOST_OPACITY });
  const ghost = new LineSegments(geometry, material);
  ghost.name = 'berth-ghost';
  return ghost;
}

/** Appends the twelve edges of a box as line-segment endpoint pairs. */
function addBoxEdgeSegments(out: number[], min: [number, number, number], max: [number, number, number]): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const rectangle = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let corner = 0; corner < 4; corner++) {
    const [ax, ay] = rectangle[corner];
    const [bx, by] = rectangle[(corner + 1) % 4];
    out.push(ax, ay, z0, bx, by, z0);
    out.push(ax, ay, z1, bx, by, z1);
    out.push(ax, ay, z0, ax, ay, z1);
  }
}

// ---- Selection ring -------------------------------------------------------------------------

const SELECTION_RING_RADIUS = 0.45;
const SELECTION_RING_SEGMENTS = 48;

/** A thin gold circle on the floor, centred on the origin; the component moves it under the selected person. */
export function buildSelectionRing(): LineLoop {
  const corners: number[] = [];
  for (let index = 0; index < SELECTION_RING_SEGMENTS; index++) {
    const angle = (index / SELECTION_RING_SEGMENTS) * Math.PI * 2;
    corners.push(SELECTION_RING_RADIUS * Math.cos(angle), SELECTION_RING_RADIUS * Math.sin(angle), 0.02);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(corners, 3));
  const material = new LineBasicMaterial({ color: displayColor(SELECTION_COLOR), transparent: true, opacity: 0.9 });
  const ring = new LineLoop(geometry, material);
  ring.name = 'selection-ring';
  ring.visible = false;
  return ring;
}

// ---- Shared geometry ------------------------------------------------------------------------

/** World points the default camera keeps in view: floor corners, door wall, car roofs, escalator top. */
export function framingPoints(layout: PlatformLayout): Vector3[] {
  const { x, y, width, height } = layout.outline;
  const { start, end } = doorWallExtent(layout);
  const carsFarY = Math.max(...layout.shuttleCars.map((car) => car.outline.y + car.outline.height));
  const escalators = escalatorFootprint(layout.escalators);
  const landingX = escalators.x - UPPER_LANDING_DEPTH;

  return [
    new Vector3(x, y, 0),
    new Vector3(x + width, y, 0),
    new Vector3(x + width, y + height, 0),
    new Vector3(x, y + height, 0),
    new Vector3(start, carsFarY, CAR_ROOF_Z),
    new Vector3(end, carsFarY, CAR_ROOF_Z),
    new Vector3(landingX, escalators.y, ESCALATOR_RISE),
    new Vector3(landingX, escalators.y + escalators.height, ESCALATOR_RISE),
  ];
}

function doorWallExtent(layout: PlatformLayout): { start: number; end: number } {
  const carOutlines = layout.shuttleCars.map((car) => car.outline);
  const start = Math.min(...carOutlines.map((outline) => outline.x)) - DOOR_WALL_OVERHANG;
  const end = Math.max(...carOutlines.map((outline) => outline.x + outline.width)) + DOOR_WALL_OVERHANG;
  return { start, end };
}

/** The rectangle covering all escalators. */
function escalatorFootprint(escalators: readonly Rect[]): Rect {
  const minX = Math.min(...escalators.map((rect) => rect.x));
  const minY = Math.min(...escalators.map((rect) => rect.y));
  const maxX = Math.max(...escalators.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...escalators.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
