import { Vector3, type PerspectiveCamera } from 'three';

/** Narrow field of view, as in the design mock: a calm, nearly isometric look. */
export const CAMERA_FOV_DEGREES = 26;

/** Turned about 20° round from straight-on toward the Door 4 end, as in the design mock. */
const DEFAULT_YAW = -Math.PI / 2 + (20 * Math.PI) / 180;
/** Look-down angle (radians above the floor) for wide views, from the design mock... */
const WIDE_VIEW_PITCH = 0.98;
/** ...and for narrower views, where looking down more steeply makes the platform taller on screen. */
const NARROW_VIEW_PITCH = 1.12;
const WIDE_ASPECT = 1.6;
const NARROW_ASPECT = 1.2;

/** Default direction from the target toward the camera, for a view of this width / height. */
export function defaultViewDirection(aspect: number): Vector3 {
  const narrowness = Math.min(1, Math.max(0, (WIDE_ASPECT - aspect) / (WIDE_ASPECT - NARROW_ASPECT)));
  const pitch = WIDE_VIEW_PITCH + (NARROW_VIEW_PITCH - WIDE_VIEW_PITCH) * narrowness;
  return new Vector3(
    Math.cos(pitch) * Math.cos(DEFAULT_YAW),
    Math.cos(pitch) * Math.sin(DEFAULT_YAW),
    Math.sin(pitch),
  ).normalize();
}

/** Share of the view the framing points may fill. */
export interface FramingFill {
  height: number;
  width: number;
}

const FITTING_PASSES = 6;
const projected = new Vector3();
const cameraRight = new Vector3();
const cameraUp = new Vector3();

/**
 * Places the camera along `direction` so the framing points fill the requested share of the view
 * and sit centred in it. Moves `target` sideways to centre them and returns the camera distance.
 * Perspective size is close to proportional to 1 / distance, so a few passes converge.
 */
export function frameCameraOnPoints(
  camera: PerspectiveCamera,
  target: Vector3,
  direction: Vector3,
  points: readonly Vector3[],
  fill: FramingFill,
  startDistance: number,
): number {
  let distance = startDistance;
  for (let pass = 0; pass < FITTING_PASSES; pass++) {
    placeCamera(camera, target, direction, distance);
    const extent = projectedExtent(camera, points);

    // Shift the target so the points' on-screen centre lands on the view centre.
    const viewHeightAtTarget = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
    const viewWidthAtTarget = viewHeightAtTarget * camera.aspect;
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(cameraRight, (extent.centerX * viewWidthAtTarget) / 2);
    target.addScaledVector(cameraUp, (extent.centerY * viewHeightAtTarget) / 2);

    const scaleForHeight = extent.height / fill.height;
    const scaleForWidth = extent.width / fill.width;
    distance *= Math.max(scaleForHeight, scaleForWidth);
  }
  placeCamera(camera, target, direction, distance);
  return distance;
}

function placeCamera(camera: PerspectiveCamera, target: Vector3, direction: Vector3, distance: number): void {
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

interface ScreenExtent {
  /** Shares of the view, 0 to 1 when the points fit. */
  width: number;
  height: number;
  /** Centre of the points in normalised device coordinates (-1 to 1, 0 is the view centre). */
  centerX: number;
  centerY: number;
}

function projectedExtent(camera: PerspectiveCamera, points: readonly Vector3[]): ScreenExtent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    projected.copy(point).project(camera);
    minX = Math.min(minX, projected.x);
    maxX = Math.max(maxX, projected.x);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  }
  // Normalised device coordinates span 2 units across the view.
  return {
    width: (maxX - minX) / 2,
    height: (maxY - minY) / 2,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * World-space point size that draws `pixels` CSS pixels wide at `distance` from the camera.
 * Three.js draws an attenuated point size × (view height in CSS px / 2) / depth CSS pixels wide
 * (times the pixel ratio in device pixels), so points look the same on any screen.
 */
export function pointSizeForPixels(pixels: number, distance: number, viewHeightCss: number): number {
  return (2 * pixels * distance) / viewHeightCss;
}
