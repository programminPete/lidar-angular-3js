import { PLATFORM_LAYOUT, type Point } from '../../data/platform-layout';
import { LabelYield, TAG_FADE_MS } from '../shared/label-yield';
import type { ScreenBox } from '../shared/screen-box';
import type { Size } from './plan-mapping';
import { chooseTagSide, indexOfBoxAt, tagOffset, type TagSide } from './tag-placement';

/** The tag dims while it slides to a new side (matches the CSS), so it never reads as crossing its dot. */
const TAG_SIDE_CHANGE_MS = 180;
/** Radius of the ring the plan draws round the selected dot; a door label that close to the dot fades. */
export const SELECTED_RING_RADIUS = 9.5;

/** The overlay's elements and the layout it reads every frame. */
export interface PlanTagOverlayParts {
  /** Follows the selected dot; holds the tag. */
  anchor: HTMLElement;
  /** The visible tag, offset to one side of the dot. */
  tag: HTMLElement;
  tagId: HTMLElement;
  tagTime: HTMLElement;
  doorLabels: () => readonly Element[];
  doorLabelBoxes: () => readonly ScreenBox[];
  panelSize: () => Size;
}

/**
 * The plan's HTML overlay for the selected person: the tag beside their dot, and the door labels
 * that give way to it. The plan's counterpart of the 3D view's OverlayLabels.
 *
 * - The anchor follows the dot every frame with a sub-pixel translate3d and no transition, so it never
 *   lags; the tag inside sits on one side of the dot (see chooseTagSide) and eases when that side changes.
 * - When the selection ends, the tag fades out where it was, then hides.
 * - A door label fades while the selected dot is under it, and steps aside (LabelYield) if the tag
 *   ever comes within 4px of it, the safety net for when no side is clear.
 *
 * Element sizes are read only when the tag's text changes, so the per-frame work is style writes.
 */
export class PlanTagOverlay {
  private side: TagSide | null = null;
  private sideChangedAt = -Infinity;
  /** True for the frame the tag appears on, while the CSS transition is switched off. */
  private isPlacing = false;
  private isShown = false;
  private isLeaving = false;
  private leavingSince = -Infinity;

  /** The tag's resting box; null while no tag is shown (it stays set while the tag fades out). Points at `shownTagBox`, reused. */
  private tagBox: ScreenBox | null = null;
  private readonly shownTagBox: ScreenBox = { x: 0, y: 0, width: 0, height: 0 };
  private shownId: string | null = null;
  private shownTime: string | null = null;
  private tagSize: Size = { width: 0, height: 0 };

  private readonly labelYields = PLATFORM_LAYOUT.doors.map(() => new LabelYield());
  private readonly labelYielding = PLATFORM_LAYOUT.doors.map(() => false);
  /** Door label the selected dot is under; -1 for none. */
  private labelOverSelection = -1;

  constructor(private readonly parts: PlanTagOverlayParts) {}

  /** Shows the tag beside the selected dot. `velocity` is the person's, in CSS pixels per second. */
  positionTag(dot: Point, velocity: Point, trackId: string, timeOnPlatform: string, now: number): void {
    const { anchor, tag } = this.parts;
    const isAppearing = !this.isShown;
    if (this.isPlacing) {
      tag.classList.remove('is-placing');
      this.isPlacing = false;
    }
    if (isAppearing) {
      // Transitions stay off until the next frame, so a newly shown tag appears in place
      // instead of sliding over from wherever it was last shown.
      tag.classList.add('is-placing');
      this.isPlacing = true;
      anchor.hidden = false;
      this.isShown = true;
    }
    if (this.isLeaving) {
      anchor.classList.remove('is-leaving');
      this.isLeaving = false;
    }
    this.updateTextIfChanged(trackId, timeOnPlatform);

    anchor.style.transform = `translate3d(${dot.x}px, ${dot.y}px, 0)`;

    const panel = this.parts.panelSize();
    const side = chooseTagSide(dot, this.tagSize, panel, this.parts.doorLabelBoxes(), this.side, velocity);
    const offset = tagOffset(side, this.tagSize);
    tag.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
    this.markSideChange(side, isAppearing, now);

    this.shownTagBox.x = dot.x + offset.x;
    this.shownTagBox.y = dot.y + offset.y;
    this.shownTagBox.width = this.tagSize.width;
    this.shownTagBox.height = this.tagSize.height;
    this.tagBox = this.shownTagBox;
  }

  /** Fades the tag out where it last was, then hides it so it no longer takes part in layout. */
  hideTag(now: number): void {
    const { anchor } = this.parts;
    if (!this.isShown) {
      return;
    }
    if (!this.isLeaving) {
      this.isLeaving = true;
      this.leavingSince = now;
      anchor.classList.add('is-leaving');
    } else if (now - this.leavingSince >= TAG_FADE_MS) {
      anchor.hidden = true;
      anchor.classList.remove('is-leaving');
      this.isLeaving = false;
      this.isShown = false;
      this.side = null;
      this.tagBox = null;
      this.shownId = null;
      this.shownTime = null;
    }
  }

  /** Fades the label over the selected dot and any label the tag comes near; the CSS does the fading. */
  yieldDoorLabels(selectedDot: Point | null, now: number): void {
    const labels = this.parts.doorLabels();
    const boxes = this.parts.doorLabelBoxes();

    const overSelection = selectedDot === null ? -1 : indexOfBoxAt(selectedDot, boxes, SELECTED_RING_RADIUS);
    if (overSelection !== this.labelOverSelection) {
      labels[this.labelOverSelection]?.classList.remove('is-over-selection');
      labels[overSelection]?.classList.add('is-over-selection');
      this.labelOverSelection = overSelection;
    }

    for (let index = 0; index < labels.length; index++) {
      const shouldYield = this.labelYields[index].update(boxes[index], this.tagBox, now);
      if (shouldYield !== this.labelYielding[index]) {
        this.labelYielding[index] = shouldYield;
        labels[index].classList.toggle('is-under-tag', shouldYield);
      }
    }
  }

  /** Text changes at most once a second; offsetWidth forces layout, so it is read only then. */
  private updateTextIfChanged(trackId: string, timeOnPlatform: string): void {
    if (trackId === this.shownId && timeOnPlatform === this.shownTime) {
      return;
    }
    this.parts.tagId.textContent = trackId;
    this.parts.tagTime.textContent = timeOnPlatform;
    this.shownId = trackId;
    this.shownTime = timeOnPlatform;
    this.tagSize = { width: this.parts.tag.offsetWidth, height: this.parts.tag.offsetHeight };
  }

  /** Dims the tag for the length of a slide to a new side; a newly shown tag does not slide. */
  private markSideChange(side: TagSide, isAppearing: boolean, now: number): void {
    const { tag } = this.parts;
    if (side !== this.side) {
      tag.dataset['side'] = side;
      if (!isAppearing) {
        tag.classList.add('is-changing-side');
        this.sideChangedAt = now;
      }
    } else if (now - this.sideChangedAt >= TAG_SIDE_CHANGE_MS) {
      tag.classList.remove('is-changing-side');
    }
    this.side = side;
  }
}
