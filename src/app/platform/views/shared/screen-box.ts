/** A box on screen in CSS pixels; (x, y) is its top-left corner. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when the two boxes overlap or are less than `gap` pixels apart. */
export function boxesAreNear(first: ScreenBox, second: ScreenBox, gap: number): boolean {
  return (
    first.x < second.x + second.width + gap &&
    first.x + first.width > second.x - gap &&
    first.y < second.y + second.height + gap &&
    first.y + first.height > second.y - gap
  );
}
