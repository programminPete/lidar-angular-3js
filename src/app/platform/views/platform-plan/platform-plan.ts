import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { PLATFORM_LAYOUT, type Point } from '../../data/platform-layout';
import { PlatformStore } from '../../state/platform-store';
import { nearestTrackId, type ScreenPoint } from '../shared/nearest-track';
import { formatTimeOnPlatform } from '../shared/time-on-platform';
import { TRACK_COLORS, trackColorRole } from '../shared/track-colors';
import { TrackMotion, type DrawablePerson } from '../shared/track-motion';
import { buildPlanDrawing, planWorldBounds, SCALE_BAR_METRES } from './plan-drawing';
import {
  fitWorldToViewport,
  planMarginsFor,
  projectPeople,
  toScreenVelocity,
  type Size,
} from './plan-mapping';
import { PlanTagOverlay, SELECTED_RING_RADIUS } from './plan-tag-overlay';

// People, in CSS pixels.
const DOT_RADIUS = 3.5;
const SELECTED_DOT_RADIUS = 4.25;
/** A click this close to a dot selects that person. */
const HIT_RADIUS = 12;
/** A tail shows the distance walked in this many seconds. */
const TAIL_SECONDS = 0.5;
/** Shorter tails would hide under the dot, so they are skipped. */
const MIN_TAIL_LENGTH = DOT_RADIUS + 2;
const TAIL_OPACITY = 0.34;

/**
 * The 2D plan: a static SVG drawing of the platform from PLATFORM_LAYOUT, a canvas on top that
 * draws people at 60 fps, and the door labels above both so people never cover them. The selected
 * person's tag and the labels that give way to it belong to PlanTagOverlay.
 */
@Component({
  selector: 'ow-platform-plan',
  templateUrl: './platform-plan.html',
  styleUrl: './platform-plan.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformPlan {
  private readonly store = inject(PlatformStore);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('peopleCanvas');
  private readonly tagAnchorRef = viewChild.required<ElementRef<HTMLElement>>('selectedTagAnchor');
  private readonly tagRef = viewChild.required<ElementRef<HTMLElement>>('selectedTag');
  private readonly tagIdRef = viewChild.required<ElementRef<HTMLElement>>('selectedTagId');
  private readonly tagTimeRef = viewChild.required<ElementRef<HTMLElement>>('selectedTagTime');
  private readonly doorLabelRefs = viewChildren<ElementRef<SVGTextElement>>('doorLabel');
  private readonly doorLabels = computed(() => this.doorLabelRefs().map((label) => label.nativeElement));

  /** Panel size in CSS pixels, set by the ResizeObserver. */
  protected readonly viewportSize = signal<Size>({ width: 0, height: 0 });
  private readonly mapping = computed(() => {
    const panel = this.viewportSize();
    return fitWorldToViewport(planWorldBounds(PLATFORM_LAYOUT), panel, planMarginsFor(panel));
  });

  protected readonly hasSize = computed(() => this.viewportSize().width > 0);
  protected readonly drawing = computed(() => buildPlanDrawing(PLATFORM_LAYOUT, this.mapping()));
  private readonly doorLabelBoxes = computed(() => this.drawing().doors.map((door) => door.labelBox));
  protected readonly isShuttleDocked = computed(() => this.store.shuttle()?.phase === 'docked');
  protected readonly areDoorsOpen = computed(() => this.store.shuttle()?.doorsOpen ?? false);
  protected readonly scaleBarLabel = `${SCALE_BAR_METRES} m`;

  // Render-loop state. Plain fields, never signals, so drawing never schedules change detection.
  private readonly motion = new TrackMotion();
  private context: CanvasRenderingContext2D | null = null;
  private pixelRatio = 1;
  private animationFrameId = 0;
  /** Where each person was drawn last frame, for clicks. Pooled: only the first `drawnCount` are current. */
  private readonly drawnPeople: ScreenPoint[] = [];
  private drawnCount = 0;
  /** Scratch velocity (CSS px/s), rewritten for each person drawn. */
  private readonly velocity: Point = { x: 0, y: 0 };

  constructor() {
    afterNextRender(() => this.startRendering());
  }

  protected selectPersonAt(event: MouseEvent): void {
    const click = { x: event.offsetX, y: event.offsetY };
    const visiblePeople = this.drawnPeople.slice(0, this.drawnCount);
    this.store.selectTrack(nearestTrackId(visiblePeople, click, HIT_RADIUS));
  }

  /** Left and Right step the selection along the platform; Escape clears it. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      this.store.stepSelection(event.key === 'ArrowRight' ? 'next' : 'previous');
    } else if (event.key === 'Escape' && this.store.selectedTrackId() !== null) {
      event.preventDefault();
      this.store.selectTrack(null);
    }
  }

  private startRendering(): void {
    this.context = this.canvasRef().nativeElement.getContext('2d');
    const tagOverlay = new PlanTagOverlay({
      anchor: this.tagAnchorRef().nativeElement,
      tag: this.tagRef().nativeElement,
      tagId: this.tagIdRef().nativeElement,
      tagTime: this.tagTimeRef().nativeElement,
      doorLabels: this.doorLabels,
      doorLabelBoxes: this.doorLabelBoxes,
      panelSize: this.viewportSize,
    });

    const resizeObserver = new ResizeObserver(([entry]) => {
      this.viewportSize.set({ width: entry.contentRect.width, height: entry.contentRect.height });
      this.resizeCanvas();
    });
    resizeObserver.observe(this.host.nativeElement);

    const renderFrame = () => {
      this.renderPeople(performance.now(), tagOverlay);
      this.animationFrameId = requestAnimationFrame(renderFrame);
    };
    this.animationFrameId = requestAnimationFrame(renderFrame);

    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.animationFrameId);
      resizeObserver.disconnect();
    });
  }

  /** Sizes the canvas backing store to the panel at the screen's pixel density. */
  private resizeCanvas(): void {
    const canvas = this.canvasRef().nativeElement;
    const { width, height } = this.viewportSize();
    this.pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * this.pixelRatio);
    canvas.height = Math.round(height * this.pixelRatio);
  }

  private renderPeople(now: number, tagOverlay: PlanTagOverlay): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    if (window.devicePixelRatio !== this.pixelRatio) {
      this.resizeCanvas();
    }

    const { width, height } = this.viewportSize();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    this.motion.update(this.store.framePair(), now);
    // Projected once per frame; drawing and clicks both read these points.
    this.drawnCount = projectPeople(this.mapping(), this.motion.people, this.drawnPeople);
    this.drawPeople(context);
    const selectedIndex = this.drawSelectedPerson(context);
    this.updateTagOverlay(tagOverlay, selectedIndex, now);
  }

  private drawPeople(context: CanvasRenderingContext2D): void {
    const people = this.motion.people;
    const keepClearIds = this.store.metrics().keepClearTrackIds;
    const selectedId = this.store.selectedTrackId();

    context.lineWidth = 1.5;
    context.lineCap = 'round';
    for (let index = 0; index < people.length; index++) {
      const person = people[index];
      if (person.id !== selectedId) {
        context.strokeStyle = TRACK_COLORS[trackColorRole(person.id, keepClearIds, null)].hex;
        context.globalAlpha = TAIL_OPACITY * person.opacity;
        this.drawTail(context, person, this.drawnPeople[index]);
      }
    }

    for (let index = 0; index < people.length; index++) {
      const person = people[index];
      if (person.id !== selectedId) {
        const point = this.drawnPeople[index];
        context.fillStyle = TRACK_COLORS[trackColorRole(person.id, keepClearIds, null)].hex;
        context.globalAlpha = person.opacity;
        context.beginPath();
        context.arc(point.x, point.y, DOT_RADIUS, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  /** Draws the selected person in gold with a ring; returns their index in `motion.people`, or -1. */
  private drawSelectedPerson(context: CanvasRenderingContext2D): number {
    const selectedId = this.store.selectedTrackId();
    const index = selectedId === null ? -1 : this.motion.people.findIndex((person) => person.id === selectedId);
    if (index === -1) {
      return -1;
    }

    const person = this.motion.people[index];
    const point = this.drawnPeople[index];
    context.strokeStyle = TRACK_COLORS.selected.hex;
    context.fillStyle = TRACK_COLORS.selected.hex;
    context.globalAlpha = 0.6 * person.opacity;
    this.drawTail(context, person, point);

    context.globalAlpha = 0.9 * person.opacity;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(point.x, point.y, SELECTED_RING_RADIUS, 0, Math.PI * 2);
    context.stroke();

    context.globalAlpha = person.opacity;
    context.beginPath();
    context.arc(point.x, point.y, SELECTED_DOT_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    return index;
  }

  /** A short line behind a walking person: where they were TAIL_SECONDS ago. */
  private drawTail(context: CanvasRenderingContext2D, person: DrawablePerson, point: ScreenPoint): void {
    if (person.speed * TAIL_SECONDS * this.mapping().scale < MIN_TAIL_LENGTH) {
      return;
    }
    const velocity = toScreenVelocity(this.mapping(), person.heading, person.speed, this.velocity);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x - velocity.x * TAIL_SECONDS, point.y - velocity.y * TAIL_SECONDS);
    context.stroke();
  }

  /** Tag beside the selected person, or fading out once nobody is selected. */
  private updateTagOverlay(overlay: PlanTagOverlay, selectedIndex: number, now: number): void {
    const track = this.store.selectedTrack();
    if (selectedIndex === -1 || track === null) {
      overlay.hideTag(now);
      overlay.yieldDoorLabels(null, now);
      return;
    }
    const person = this.motion.people[selectedIndex];
    const point = this.drawnPeople[selectedIndex];
    const timeOnPlatform = formatTimeOnPlatform(this.store.clock() - track.firstSeen);
    const velocity = toScreenVelocity(this.mapping(), person.heading, person.speed, this.velocity);
    overlay.positionTag(point, velocity, track.id, timeOnPlatform, now);
    overlay.yieldDoorLabels(point, now);
  }
}
