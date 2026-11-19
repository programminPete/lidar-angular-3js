import { boxesAreNear, type ScreenBox } from './screen-box';

/** A door label gives way when the selected tag comes this close to it. */
export const YIELD_GAP_PIXELS = 4;
/** A label comes back once the tag has been clear of it this long, so it does not flicker. */
export const RETURN_DELAY_MS = 300;
/** The selected tag fades out over this long in both views; matches their CSS transitions. */
export const TAG_FADE_MS = 150;

/**
 * Whether one door label should step aside for the selected tag. Both views keep one per label.
 * It hides as soon as the tag is near and stays hidden until the tag has been clear for RETURN_DELAY_MS.
 * Holds a single timestamp, so updating it every animation frame allocates nothing.
 */
export class LabelYield {
  private lastNearAt = -Infinity;

  /** `tagBox` is null when no tag is shown. `now` is in milliseconds. Returns true while the label should be hidden. */
  update(labelBox: ScreenBox, tagBox: ScreenBox | null, now: number): boolean {
    if (tagBox !== null && boxesAreNear(labelBox, tagBox, YIELD_GAP_PIXELS)) {
      this.lastNearAt = now;
    }
    return now - this.lastNearAt < RETURN_DELAY_MS;
  }
}
