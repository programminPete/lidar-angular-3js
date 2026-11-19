import type { Point } from '../../data/platform-layout';
import { boxesAreNear, type ScreenBox } from '../shared/screen-box';
import type { Size } from './plan-mapping';

/** Where the tag sits relative to the selected dot. */
export type TagSide = 'right' | 'left' | 'above' | 'below';

/** Order of preference when a new side has to be chosen. */
const SIDES: readonly TagSide[] = ['right', 'left', 'below', 'above'];

/** Gap, in CSS pixels, between the selected dot and the nearest edge of its tag. */
const TAG_GAP = 14;
/** The tag never comes closer than this to a panel edge. */
const PANEL_INSET = 8;
/** A side is usable while the tag stays at least this far from every obstacle. */
const OBSTACLE_GAP = 4;
/** A new side is judged along the person's path at these times ahead, in seconds. */
const PATH_SAMPLE_SECONDS: readonly number[] = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Picks the tag's side for this animation frame, given the side used last frame and the person's
 * velocity on screen (CSS pixels per second).
 *
 * Sticky: the current side is kept while it is usable (inside the panel and at least 4px clear of
 * every obstacle, such as the door labels). Only when it is blocked does the tag move, to the side
 * that will stay usable longest along the person's path over the next two seconds (ties go to the
 * earlier side in right, left, below, above). So walking past a door label costs one change of side
 * where geometry allows, and never a quick back-and-forth. There is no timed return to a preferred
 * side: a new side is held for as long as it stays clear. With nowhere usable it stays put.
 */
export function chooseTagSide(
  dot: Point,
  tag: Size,
  panel: Size,
  obstacles: readonly ScreenBox[],
  previousSide: TagSide | null,
  velocity: Point = { x: 0, y: 0 },
): TagSide {
  const isClearAt = (seconds: number, side: TagSide) => {
    const point = { x: dot.x + velocity.x * seconds, y: dot.y + velocity.y * seconds };
    return isSideClear(point, tag, panel, obstacles, side, OBSTACLE_GAP);
  };
  /** How many path samples, from now on, the side stays usable for. */
  const clearRun = (side: TagSide) => {
    const firstBlocked = PATH_SAMPLE_SECONDS.findIndex((seconds) => !isClearAt(seconds, side));
    return firstBlocked === -1 ? PATH_SAMPLE_SECONDS.length : firstBlocked;
  };

  if (previousSide !== null && isClearAt(0, previousSide)) {
    return previousSide;
  }
  let best: TagSide | null = null;
  let bestRun = 0;
  for (const side of SIDES) {
    const run = clearRun(side);
    if (run > bestRun) {
      best = side;
      bestRun = run;
    }
  }
  return best ?? previousSide ?? 'right';
}

/** Offset from the dot to the tag's top-left corner for a side. */
export function tagOffset(side: TagSide, tag: Size): Point {
  switch (side) {
    case 'right':
      return { x: TAG_GAP, y: -tag.height / 2 };
    case 'left':
      return { x: -TAG_GAP - tag.width, y: -tag.height / 2 };
    case 'above':
      return { x: -tag.width / 2, y: -TAG_GAP - tag.height };
    case 'below':
      return { x: -tag.width / 2, y: TAG_GAP };
  }
}

/** Index of the box the point lies in (or within `gap` of), or -1. */
export function indexOfBoxAt(point: Point, boxes: readonly ScreenBox[], gap: number): number {
  return boxes.findIndex((box) => boxesAreNear({ x: point.x, y: point.y, width: 0, height: 0 }, box, gap));
}

function isSideClear(dot: Point, tag: Size, panel: Size, obstacles: readonly ScreenBox[], side: TagSide, gap: number): boolean {
  const offset = tagOffset(side, tag);
  const box = { x: dot.x + offset.x, y: dot.y + offset.y, width: tag.width, height: tag.height };
  return fitsInPanel(box, panel) && !obstacles.some((obstacle) => boxesAreNear(box, obstacle, gap));
}

function fitsInPanel(box: ScreenBox, panel: Size): boolean {
  return (
    box.x >= PANEL_INSET &&
    box.y >= PANEL_INSET &&
    box.x + box.width <= panel.width - PANEL_INSET &&
    box.y + box.height <= panel.height - PANEL_INSET
  );
}
