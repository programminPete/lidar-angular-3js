import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Vector3 } from 'three';
import { PLATFORM_LAYOUT } from '../../data/platform-layout';
import { PlatformStore } from '../../state/platform-store';
import { nearestTrackId, type ScreenPoint } from '../shared/nearest-track';
import { formatTimeOnPlatform } from '../shared/time-on-platform';
import { TrackMotion } from '../shared/track-motion';
import { OverlayLabels } from './overlay-labels';
import { PointCloudStage } from './point-cloud-stage';
import { ShuttleMotion } from './shuttle-motion';

/** A press that moves further than this is an orbit drag, not a click. */
const CLICK_SLOP_PIXELS = 5;
/** A click selects the nearest person within this distance on screen. */
const PICK_RADIUS_PIXELS = 28;
/** Height on a person's body used for picking: about the waist. */
const PICK_HEIGHT_METRES = 1;

/**
 * The 3D view: a point cloud of the platform with everyone on it.
 *
 * Angular owns the lifecycle, input events and the overlay text; Three.js draws in its own
 * requestAnimationFrame loop. The loop only reads the store and writes to the canvas and overlay
 * styles (no signal writes, no template bindings), so it never triggers change detection.
 */
@Component({
  selector: 'ow-platform-3d',
  templateUrl: './platform-3d.html',
  styleUrl: './platform-3d.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Platform3d {
  private readonly store = inject(PlatformStore);
  private readonly viewport = viewChild.required<ElementRef<HTMLDivElement>>('viewport');
  private readonly doorLabelRefs = viewChildren<ElementRef<HTMLElement>>('doorLabel');
  private readonly doorLabels = computed(() => this.doorLabelRefs().map((label) => label.nativeElement));
  private readonly selectedTag = viewChild.required<ElementRef<HTMLElement>>('selectedTag');

  protected readonly doors = PLATFORM_LAYOUT.doors;
  private readonly timeOnPlatform = computed(() => {
    const track = this.store.selectedTrack();
    return track === null ? null : formatTimeOnPlatform(this.store.clock() - track.firstSeen);
  });

  /**
   * Tag text. Both keep their last value when the selection ends, so the tag can fade out
   * showing who it was rather than going blank.
   */
  protected readonly tagId = linkedSignal<string | null, string>({
    source: () => this.store.selectedTrack()?.id ?? null,
    computation: (id, previous) => id ?? previous?.value ?? '',
  });
  protected readonly tagTime = linkedSignal<string | null, string>({
    source: () => this.timeOnPlatform(),
    computation: (time, previous) => time ?? previous?.value ?? '',
  });
  private readonly stage = new PointCloudStage();
  private readonly overlay = new OverlayLabels(this.stage);
  private readonly motion = new TrackMotion();
  private readonly shuttle = new ShuttleMotion();
  private readonly resizeObserver = new ResizeObserver((entries) => this.onResize(entries));
  /** Reused for projections, so the loop allocates nothing. */
  private readonly projected = new Vector3();

  private frameRequest: number | null = null;
  private lastFrameTime = 0;
  private doorLabelsNeedPositioning = true;
  private pressX = 0;
  private pressY = 0;

  constructor() {
    afterNextRender(() => this.start());
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  // ---- Lifecycle ----------------------------------------------------------------------------

  private start(): void {
    const viewport = this.viewport().nativeElement;
    viewport.appendChild(this.stage.canvas);
    this.resizeObserver.observe(viewport);
    this.stage.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.stage.canvas.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.requestFrame();
  }

  private stop(): void {
    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
    }
    this.resizeObserver.disconnect();
    this.stage.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.stage.canvas.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stage.dispose();
  }

  private requestFrame(): void {
    this.frameRequest = requestAnimationFrame(this.renderFrame);
  }

  // The browser already pauses animation frames in hidden tabs; resetting the clock on return
  // avoids one huge time step that would jump the shuttle easing.
  private readonly onVisibilityChange = (): void => {
    this.lastFrameTime = performance.now();
  };

  private onResize(entries: ResizeObserverEntry[]): void {
    const { width, height } = entries[0].contentRect;
    if (width === 0 || height === 0) {
      return;
    }
    this.stage.resize(width, height);
    this.doorLabelsNeedPositioning = true;
    // Draw now so the canvas never shows a stretched frame between resize and the next tick.
    this.stage.render();
  }

  // ---- Render loop --------------------------------------------------------------------------

  private readonly renderFrame = (now: number): void => {
    this.requestFrame();
    const elapsedSeconds = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    if (this.stage.updateCamera()) {
      this.doorLabelsNeedPositioning = true;
    }
    this.updatePeople(now);
    this.shuttle.update(this.store.shuttle(), this.store.clock(), elapsedSeconds);
    this.stage.setShuttle(this.shuttle.offsetMetres, this.shuttle.opacity);
    this.stage.render();
    this.updateOverlay(now);
  };

  private updatePeople(now: number): void {
    this.motion.update(this.store.framePair(), now);
    const keepClearIds = this.store.metrics().keepClearTrackIds;
    this.stage.people.updatePeople(this.motion.people, keepClearIds, this.store.selectedTrackId());
  }

  /** Selection ring and tag follow the selected person; door labels move only with the camera. */
  private updateOverlay(now: number): void {
    const doorLabels = this.doorLabels();
    if (this.doorLabelsNeedPositioning) {
      this.overlay.positionDoorLabels(doorLabels);
      this.doorLabelsNeedPositioning = false;
    }

    const selectedId = this.store.selectedTrackId();
    const index = selectedId === null ? -1 : this.stage.people.indexOf(selectedId);
    const selectedX = index === -1 ? null : this.stage.people.xAt(index);
    const selectedY = index === -1 ? 0 : this.stage.people.yAt(index);
    this.stage.setSelectionRing(selectedX, selectedY);

    this.overlay.positionTag(this.selectedTag().nativeElement, selectedX, selectedY, now);
    this.overlay.yieldDoorLabels(doorLabels, now);
  }

  // ---- Selection ----------------------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pressX = event.clientX;
    this.pressY = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const movedPixels = Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY);
    if (movedPixels > CLICK_SLOP_PIXELS) {
      return;
    }
    const bounds = this.stage.canvas.getBoundingClientRect();
    const click = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    this.store.selectTrack(nearestTrackId(this.peopleOnScreen(), click, PICK_RADIUS_PIXELS));
  };

  /** Where each drawn person is on screen. Built only on click, so it may allocate. */
  private peopleOnScreen(): ScreenPoint[] {
    const people = this.stage.people;
    const points: ScreenPoint[] = [];
    for (let index = 0; index < people.count; index++) {
      const onScreen = this.stage.project(people.xAt(index), people.yAt(index), PICK_HEIGHT_METRES, this.projected);
      points.push({ id: people.idAt(index), x: onScreen.x, y: onScreen.y });
    }
    return points;
  }

  /** Left and Right step through people along the platform; Escape clears the selection. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') {
      this.store.stepSelection('next');
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      this.store.stepSelection('previous');
      event.preventDefault();
    } else if (event.key === 'Escape') {
      this.store.selectTrack(null);
    }
  }
}
