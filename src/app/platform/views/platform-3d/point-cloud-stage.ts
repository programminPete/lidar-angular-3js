import {
  Fog,
  LinearSRGBColorSpace,
  Line,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLATFORM_LAYOUT } from '../../data/platform-layout';
import { CAMERA_FOV_DEGREES, defaultViewDirection, frameCameraOnPoints, pointSizeForPixels } from './camera-framing';
import { PeopleCloud } from './people-cloud';
import {
  BERTH_GHOST_OPACITY,
  buildBerthGhost,
  buildSelectionRing,
  buildShuttleCars,
  buildStaticStructure,
  framingPoints,
} from './platform-scene';
import { VIEWPORT_BACKGROUND, displayColor } from './point-cloud-colors';

/** Share of the view the platform and berth fill in the default framing. */
const DEFAULT_FILL = { height: 0.88, width: 0.94 };
/** Point size in CSS pixels at the default framing distance. */
const POINT_SIZE_PIXELS = 1.3;
/** People's points are drawn a little larger than structure, so figures read solid, as in the mock. */
const PEOPLE_POINT_SCALE = 1.3;
const MAX_PIXEL_RATIO = 2;
/** Fog starts and ends at these multiples of the camera's distance to the target. */
const FOG_START = 0.75;
const FOG_END = 2.2;

/**
 * Everything Three.js: renderer, scene, camera, orbit controls and the objects in the scene.
 * The component tells it what changed (people, shuttle, selection, size) and when to draw.
 * Coordinates are the platform frame: metres, z up.
 */
export class PointCloudStage {
  readonly canvas: HTMLCanvasElement;
  readonly people = new PeopleCloud();

  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.5, 600);
  private readonly controls: OrbitControls;
  private readonly fog = new Fog(0x000000, 50, 150);
  private readonly staticStructure = buildStaticStructure(PLATFORM_LAYOUT);
  private readonly shuttleCars = buildShuttleCars(PLATFORM_LAYOUT);
  private readonly berthGhost = buildBerthGhost(PLATFORM_LAYOUT);
  private readonly selectionRing = buildSelectionRing();
  private readonly pointsToFrame = framingPoints(PLATFORM_LAYOUT);
  private readonly platformCentre = new Vector3(
    PLATFORM_LAYOUT.outline.x + PLATFORM_LAYOUT.outline.width / 2,
    PLATFORM_LAYOUT.outline.y + PLATFORM_LAYOUT.outline.height / 2,
    0,
  );
  private hasFramed = false;
  private pixelRatioQuery: MediaQueryList | null = null;
  viewWidth = 0;
  viewHeight = 0;

  constructor() {
    // z is up in the platform frame; OrbitControls reads camera.up when it is created.
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Polar angle is measured from the +z axis (0 looks straight down); stop well above the floor.
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = (80 * Math.PI) / 180;

    // Colours are added in display space, like the Canvas 2D design mock, so skip sRGB encoding.
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setClearColor(displayColor(VIEWPORT_BACKGROUND));
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    this.applyPixelRatio();
    this.watchPixelRatio();

    this.scene.fog = this.fog;
    this.scene.add(this.staticStructure, this.berthGhost, this.shuttleCars, this.people.points, this.selectionRing);
  }

  /** Applies damping. True when the camera moved, so screen-anchored labels need re-placing. */
  updateCamera(): boolean {
    const moved = this.controls.update();
    if (moved) {
      this.updateFog();
    }
    return moved;
  }

  /** Slides the cars along x and cross-fades them with the faint berth outline. */
  setShuttle(offsetMetres: number, opacity: number): void {
    this.shuttleCars.visible = opacity > 0;
    this.shuttleCars.position.x = offsetMetres;
    this.shuttleCars.material.opacity = opacity;
    this.berthGhost.material.opacity = BERTH_GHOST_OPACITY * (1 - opacity);
  }

  /** Puts the gold floor ring under the selected person, or hides it with null. */
  setSelectionRing(x: number | null, y: number): void {
    this.selectionRing.visible = x !== null;
    if (x !== null) {
      this.selectionRing.position.set(x, y, 0);
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** CSS-pixel position of a world point, relative to the view's top left, written into `out`. */
  project(x: number, y: number, z: number, out: Vector3): Vector3 {
    out.set(x, y, z).project(this.camera);
    out.x = ((out.x + 1) / 2) * this.viewWidth;
    out.y = ((1 - out.y) / 2) * this.viewHeight;
    return out;
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.renderer.setSize(width, height);
    this.people.setViewHeight(height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frameThePlatform();
  }

  dispose(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.controls.dispose();
    this.scene.traverse(disposeObject);
    this.renderer.dispose();
    // Release the WebGL context now rather than at garbage collection: switching between
    // Plan and 3D creates a new one each time, and browsers cap live contexts.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  }

  /**
   * Moving the window to a monitor with another pixel density changes devicePixelRatio without
   * changing the CSS size, so ResizeObserver never fires. (Browser zoom changes both, so it is
   * caught by either path.) A media query for the current ratio stops matching when the ratio
   * changes; re-arm it for the new ratio each time.
   */
  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.pixelRatioQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private readonly onPixelRatioChange = (): void => {
    this.applyPixelRatio();
    this.watchPixelRatio();
  };

  /**
   * Fits the platform and the shuttle berth in the view: from the default angle on first show,
   * and from whatever angle the user has orbited to after that.
   */
  private frameThePlatform(): void {
    const direction = this.hasFramed
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : defaultViewDirection(this.camera.aspect);
    const startDistance = this.hasFramed ? this.camera.position.distanceTo(this.controls.target) : 60;

    this.controls.target.copy(this.platformCentre);
    const distance = frameCameraOnPoints(this.camera, this.controls.target, direction, this.pointsToFrame, DEFAULT_FILL, startDistance);
    this.controls.minDistance = distance * 0.3;
    this.controls.maxDistance = distance * 1.8;
    this.controls.update();
    this.hasFramed = true;

    this.setPointSize(pointSizeForPixels(POINT_SIZE_PIXELS, distance, this.viewHeight));
    this.updateFog();
  }

  private setPointSize(size: number): void {
    this.scene.traverse((object) => {
      if (object instanceof Points) {
        object.material.size = size;
      }
    });
    this.people.points.material.size = size * PEOPLE_POINT_SCALE;
  }

  private updateFog(): void {
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.fog.near = distance * FOG_START;
    this.fog.far = distance * FOG_END;
  }
}

function disposeObject(object: Object3D): void {
  if (object instanceof Points || object instanceof Line || object instanceof Mesh) {
    object.geometry.dispose();
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.dispose();
    }
  }
}
