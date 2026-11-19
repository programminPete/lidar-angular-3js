import { Vector3 } from 'three';
import { PLATFORM_LAYOUT } from '../../data/platform-layout';
import { LabelYield, TAG_FADE_MS } from '../shared/label-yield';
import type { ScreenBox } from '../shared/screen-box';
import { DOOR_WALL_HEIGHT } from './platform-scene';
import type { PointCloudStage } from './point-cloud-stage';

/** Door labels sit just above the top of each door frame, clear of the crowd. */
const DOOR_LABEL_HEIGHT_METRES = DOOR_WALL_HEIGHT + 0.25;
/** The selected tag hangs above the head on a leader line this long (matches the CSS). */
const TAG_ANCHOR_HEIGHT_METRES = 1.95;
const TAG_LEADER_PIXELS = 14;

/**
 * Places the HTML overlay (door labels and the selected-person tag) over the canvas by
 * projecting world points to the screen. HTML keeps text crisp at any zoom, unlike text drawn in WebGL.
 *
 * The tag never moves out of the way; a door label it comes near fades out instead (see LabelYield).
 * Element sizes are read rarely: door labels when the camera moves (before any label is moved),
 * and the tag only when its text changes, so the per-frame work is style writes alone.
 */
export class OverlayLabels {
  private readonly projected = new Vector3();
  private readonly doorLabelBoxes: ScreenBox[] = PLATFORM_LAYOUT.doors.map(() => ({ x: 0, y: 0, width: 0, height: 0 }));
  private readonly labelYields = PLATFORM_LAYOUT.doors.map(() => new LabelYield());
  private readonly labelHidden = PLATFORM_LAYOUT.doors.map(() => false);

  /** The tag's box this frame; null while no one is selected. Points at `shownTagBox`, reused every frame. */
  private tagBox: ScreenBox | null = null;
  private readonly shownTagBox: ScreenBox = { x: 0, y: 0, width: 0, height: 0 };
  private tagHiddenSince = -Infinity;
  /** The tag's size, measured when its text last changed. */
  private tagText: string | null = null;
  private tagWidth = 0;
  private tagHeight = 0;

  constructor(private readonly stage: PointCloudStage) {}

  /** Labels are anchored at their bottom centre (see `.door-label` in the CSS). Call when the camera moves. */
  positionDoorLabels(labels: readonly HTMLElement[]): void {
    const sizes = labels.map((label) => ({ width: label.offsetWidth, height: label.offsetHeight }));
    labels.forEach((label, index) => {
      const door = PLATFORM_LAYOUT.doors[index];
      const anchor = this.stage.project(door.center.x, door.center.y, DOOR_LABEL_HEIGHT_METRES, this.projected);
      placeElement(label, anchor.x, anchor.y);

      const box = this.doorLabelBoxes[index];
      box.x = anchor.x - sizes[index].width / 2;
      box.y = anchor.y - sizes[index].height;
      box.width = sizes[index].width;
      box.height = sizes[index].height;
    });
  }

  /**
   * Hangs the tag above the selected person. With `x` null (nobody selected, or they have left)
   * the tag fades out where it last was.
   */
  positionTag(tag: HTMLElement, x: number | null, y: number, now: number): void {
    if (x === null) {
      this.fadeOutTag(tag, now);
      return;
    }
    tag.hidden = false;
    tag.classList.add('is-shown');
    this.measureTagIfChanged(tag);
    const anchor = this.stage.project(x, y, TAG_ANCHOR_HEIGHT_METRES, this.projected);
    placeElement(tag, anchor.x, anchor.y);

    this.shownTagBox.x = anchor.x - this.tagWidth / 2;
    this.shownTagBox.y = anchor.y - TAG_LEADER_PIXELS - this.tagHeight;
    this.shownTagBox.width = this.tagWidth;
    this.shownTagBox.height = this.tagHeight;
    this.tagBox = this.shownTagBox;
  }

  /** Fades the tag out where it last was, then hides it so it no longer takes part in layout. */
  private fadeOutTag(tag: HTMLElement, now: number): void {
    if (this.tagBox !== null) {
      this.tagBox = null;
      this.tagHiddenSince = now;
      tag.classList.remove('is-shown');
    }
    if (!tag.hidden && now - this.tagHiddenSince >= TAG_FADE_MS) {
      tag.hidden = true;
    }
  }

  /** Fades out any door label the tag is near; the CSS transition does the fading. `now` in ms. */
  yieldDoorLabels(labels: readonly HTMLElement[], now: number): void {
    for (let index = 0; index < labels.length; index++) {
      const shouldHide = this.labelYields[index].update(this.doorLabelBoxes[index], this.tagBox, now);
      if (shouldHide !== this.labelHidden[index]) {
        this.labelHidden[index] = shouldHide;
        labels[index].classList.toggle('is-yielding', shouldHide);
      }
    }
  }

  /** Reading textContent is cheap; offsetWidth forces layout, so it runs once per text change. */
  private measureTagIfChanged(tag: HTMLElement): void {
    const text = tag.textContent;
    if (text === this.tagText) {
      return;
    }
    this.tagText = text;
    this.tagWidth = tag.offsetWidth;
    this.tagHeight = tag.offsetHeight;
  }
}

/** Moves an overlay element to a view position, rounded to whole pixels so text stays crisp. */
function placeElement(element: HTMLElement, x: number, y: number): void {
  element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
