import { SeededRandom } from '../../data/simulation/seeded-random';

/**
 * A person as a fixed set of points, in the person's own frame:
 * metres; `forward` along the heading, `left` 90° counter-clockwise from it, `up` from the floor.
 * Every template has exactly HUMAN_POINT_COUNT points, so each person takes the same
 * number of slots in the shared people buffer.
 */
export interface HumanTemplate {
  /** forward, left, up for each point. */
  positions: Float32Array;
  /** 0 to 1 per point; feet are dimmer than the head, like returns in the design mock. */
  brightness: Float32Array;
}

interface BodyShape {
  /** Standing height in metres. */
  height: number;
  /** Width multiplier for shoulders, hips and limbs. */
  build: number;
}

/** Height and build variants. A person keeps one for life (see `templateIndexForTrackId`). */
const BODY_SHAPES: readonly BodyShape[] = [
  { height: 1.62, build: 0.92 },
  { height: 1.68, build: 0.98 },
  { height: 1.72, build: 1.04 },
  { height: 1.76, build: 0.96 },
  { height: 1.81, build: 1.08 },
  { height: 1.86, build: 1.02 },
];

/** Proportions below are for this reference height and scale with each shape. */
const REFERENCE_HEIGHT = 1.72;

const POINTS_PER_LEG = 46;
const POINTS_PER_FOOT = 6;
const TORSO_POINTS = 80;
const SHOULDER_POINTS = 20;
const POINTS_PER_UPPER_ARM = 14;
const POINTS_PER_FOREARM = 10;
const NECK_POINTS = 6;
const HEAD_POINTS = 40;

export const HUMAN_POINT_COUNT =
  2 * (POINTS_PER_LEG + POINTS_PER_FOOT) +
  TORSO_POINTS +
  SHOULDER_POINTS +
  2 * (POINTS_PER_UPPER_ARM + POINTS_PER_FOREARM) +
  NECK_POINTS +
  HEAD_POINTS;

type Vec3 = [forward: number, left: number, up: number];

/** Writes points into a template's arrays, adding a little scanner noise to each one. */
class TemplateWriter {
  readonly positions = new Float32Array(HUMAN_POINT_COUNT * 3);
  readonly brightness = new Float32Array(HUMAN_POINT_COUNT);
  private written = 0;

  constructor(private readonly random: SeededRandom) {}

  addPoint(forward: number, left: number, up: number, brightness: number): void {
    const offset = this.written * 3;
    this.positions[offset] = forward + this.noise(0.007);
    this.positions[offset + 1] = left + this.noise(0.007);
    this.positions[offset + 2] = up + this.noise(0.005);
    this.brightness[this.written] = brightness;
    this.written++;
  }

  /** Points scattered on a tapered tube from `start` to `end`. */
  addLimb(start: Vec3, end: Vec3, startRadius: number, endRadius: number, count: number, startBrightness: number, endBrightness: number): void {
    for (let index = 0; index < count; index++) {
      const along = this.random.next();
      const angle = this.random.next() * Math.PI * 2;
      const radius = lerp(startRadius, endRadius, along);
      this.addPoint(
        lerp(start[0], end[0], along) + radius * Math.cos(angle),
        lerp(start[1], end[1], along) + radius * Math.sin(angle),
        lerp(start[2], end[2], along),
        lerp(startBrightness, endBrightness, along),
      );
    }
  }

  private noise(spread: number): number {
    return (this.random.next() - 0.5) * 2 * spread;
  }
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** A standing person facing +forward, after `person()` in design-lab/kit/pc.js. */
function createHumanTemplate(shape: BodyShape, random: SeededRandom): HumanTemplate {
  const writer = new TemplateWriter(random);
  const scale = shape.height / REFERENCE_HEIGHT;
  const width = shape.build;
  const stance = (random.next() - 0.5) * 0.1;
  const armSwing = 0.02 + random.next() * 0.04;

  for (const side of [-1, 1]) {
    const foot: Vec3 = [side * stance * 0.5, side * 0.1 * width, 0.03];
    const hip: Vec3 = [0, side * 0.092 * width, 0.84 * scale];
    writer.addLimb(foot, hip, 0.048 * width, 0.078 * width, POINTS_PER_LEG, 0.4, 0.56);
    for (let index = 0; index < POINTS_PER_FOOT; index++) {
      writer.addPoint(foot[0] + 0.02 + random.next() * 0.16, foot[1] + (random.next() - 0.5) * 0.08, 0.02 + random.next() * 0.07, 0.34);
    }
  }

  // Pelvis and torso: an elliptical tube, deeper side to side and widening toward the shoulders.
  for (let index = 0; index < TORSO_POINTS; index++) {
    const along = random.next();
    const angle = random.next() * Math.PI * 2;
    const frontToBack = (0.105 + 0.025 * along) * width;
    const sideToSide = (0.162 + 0.058 * along * along) * width;
    writer.addPoint(frontToBack * Math.cos(angle), sideToSide * Math.sin(angle), lerp(0.82, 1.43, along) * scale, 0.58 + 0.24 * along);
  }

  for (let index = 0; index < SHOULDER_POINTS; index++) {
    const angle = random.next() * Math.PI * 2;
    const radius = Math.sqrt(random.next());
    const up = (1.43 + 0.035 * (1 - radius * radius)) * scale;
    writer.addPoint(0.13 * width * radius * Math.cos(angle), 0.22 * width * radius * Math.sin(angle), up, 0.92);
  }

  for (const side of [-1, 1]) {
    const swing = -side * armSwing;
    const shoulder: Vec3 = [0, side * 0.215 * width, 1.4 * scale];
    const elbow: Vec3 = [swing * 0.5, side * 0.235 * width, 1.1 * scale];
    const hand: Vec3 = [swing + 0.04, side * 0.245 * width, 0.8 * scale];
    writer.addLimb(shoulder, elbow, 0.047, 0.042, POINTS_PER_UPPER_ARM, 0.78, 0.66);
    writer.addLimb(elbow, hand, 0.04, 0.034, POINTS_PER_FOREARM, 0.66, 0.58);
  }

  writer.addLimb([0, 0, 1.44 * scale], [0, 0, 1.53 * scale], 0.05, 0.05, NECK_POINTS, 0.85, 0.85);

  // Head: points on an ellipsoid, slightly taller than it is wide.
  for (let index = 0; index < HEAD_POINTS; index++) {
    const direction = randomUnitVector(random);
    writer.addPoint(0.015 + direction[0] * 0.1 * scale, direction[1] * 0.083 * scale, 1.615 * scale + direction[2] * 0.112 * scale, 1);
  }

  return { positions: writer.positions, brightness: writer.brightness };
}

function randomUnitVector(random: SeededRandom): Vec3 {
  const z = random.between(-1, 1);
  const angle = random.next() * Math.PI * 2;
  const ring = Math.sqrt(1 - z * z);
  return [ring * Math.cos(angle), ring * Math.sin(angle), z];
}

/** One template per body shape. The same seed always gives the same people. */
export function createHumanTemplates(seed: number): HumanTemplate[] {
  const random = new SeededRandom(seed);
  return BODY_SHAPES.map((shape) => createHumanTemplate(shape, random));
}

/** Stable template choice for a track (FNV-1a hash of the id), so a person keeps their shape. */
export function templateIndexForTrackId(trackId: string, templateCount: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < trackId.length; index++) {
    hash ^= trackId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % templateCount;
}
