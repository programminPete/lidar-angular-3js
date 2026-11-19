import { BufferGeometry, Float32BufferAttribute } from 'three';
import { SeededRandom } from '../../data/simulation/seeded-random';
import { STRUCTURE_HIGH, STRUCTURE_LOW } from './point-cloud-colors';

/** [x, y, z] in metres, platform frame, z up. */
export type Vec3 = [x: number, y: number, z: number];

export interface SampleStyle {
  /** Brightness of each point, before additive blending. */
  alpha: number;
  /** Metres between neighbouring points. */
  spacing?: number;
}

export interface WallStyle extends SampleStyle {
  /** Metres between horizontal scan rows. */
  rowSpacing?: number;
  /** Share of points dropped, 0 to 1. The top and bottom rows are never dropped. */
  dropout?: number;
  /** Height of the bottom row. */
  baseZ?: number;
}

/**
 * Collects static points the way a LiDAR scan would return them: on surfaces, slightly noisy,
 * structure tinted from dark blue-gray near the floor to lighter blue-gray higher up.
 * Shapes are sampled with a seeded random source so every build looks the same.
 * After `design-lab/kit/pc.js`.
 */
export class PointCloudBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  constructor(private readonly random: SeededRandom) {}

  addPoint(x: number, y: number, z: number, alpha: number): void {
    const shade = structureShade(z);
    this.positions.push(x, y, z);
    this.colors.push(
      lerp(STRUCTURE_LOW.r, STRUCTURE_HIGH.r, shade) * alpha,
      lerp(STRUCTURE_LOW.g, STRUCTURE_HIGH.g, shade) * alpha,
      lerp(STRUCTURE_LOW.b, STRUCTURE_HIGH.b, shade) * alpha,
    );
  }

  /** A straight line of points, such as a handrail or a door post. */
  addSegment(from: Vec3, to: Vec3, style: SampleStyle): void {
    const spacing = style.spacing ?? 0.03;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const steps = Math.max(2, Math.round(length / spacing));
    for (let step = 0; step <= steps; step++) {
      const along = step / steps;
      this.addPoint(
        lerp(from[0], to[0], along) + this.noise(0.003),
        lerp(from[1], to[1], along) + this.noise(0.003),
        lerp(from[2], to[2], along) + this.noise(0.003),
        style.alpha,
      );
    }
  }

  /** A vertical plane between two floor points, sampled in horizontal scan rows. */
  addWall(from: [x: number, y: number], to: [x: number, y: number], height: number, style: WallStyle): void {
    const spacing = style.spacing ?? 0.08;
    const rowSpacing = style.rowSpacing ?? 0.14;
    const dropout = style.dropout ?? 0.12;
    const baseZ = style.baseZ ?? 0;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const rows = Math.max(1, Math.round(height / rowSpacing));
    const pointsPerRow = Math.max(2, Math.round(length / spacing));

    for (let row = 0; row <= rows; row++) {
      const z = baseZ + (row / rows) * height;
      const isEdgeRow = row === 0 || row === rows;
      for (let index = 0; index < pointsPerRow; index++) {
        if (!isEdgeRow && this.random.next() < dropout) {
          continue;
        }
        const along = (index + this.random.next()) / pointsPerRow;
        this.addPoint(lerp(from[0], to[0], along), lerp(from[1], to[1], along), z, style.alpha);
      }
    }
  }

  /** The twelve edges of an axis-aligned box from `min` to `max`. */
  addBoxEdges(min: Vec3, max: Vec3, style: SampleStyle): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    for (const z of [z0, z1]) {
      this.addSegment([x0, y0, z], [x1, y0, z], style);
      this.addSegment([x1, y0, z], [x1, y1, z], style);
      this.addSegment([x1, y1, z], [x0, y1, z], style);
      this.addSegment([x0, y1, z], [x0, y0, z], style);
    }
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
      this.addSegment([x, y, z0], [x, y, z1], style);
    }
  }

  /** Random points on a horizontal rectangle at height z. `density` is points per square metre. */
  addSurface(min: [x: number, y: number], max: [x: number, y: number], z: number, density: number, alpha: number): void {
    const area = (max[0] - min[0]) * (max[1] - min[1]);
    const count = Math.round(area * density);
    for (let index = 0; index < count; index++) {
      this.addPoint(this.random.between(min[0], max[0]), this.random.between(min[1], max[1]), z, alpha);
    }
  }

  toGeometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    return geometry;
  }

  private noise(spread: number): number {
    return (this.random.next() - 0.5) * 2 * spread;
  }
}

/** 0 at the floor to about 0.76 at 2.8 m: higher structure reads lighter. */
function structureShade(z: number): number {
  const heightShare = Math.min(1, Math.max(0, z / 2.8));
  return Math.min(1, Math.max(0, 0.16 + 0.6 * heightShare));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
