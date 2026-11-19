import { LabelYield, RETURN_DELAY_MS } from './label-yield';
import { boxesAreNear, type ScreenBox } from './screen-box';

const label: ScreenBox = { x: 100, y: 80, width: 50, height: 18 };

function tagAt(x: number, y: number): ScreenBox {
  return { x, y, width: 120, height: 22 };
}

describe('boxesAreNear', () => {
  it('counts overlapping boxes as near', () => {
    expect(boxesAreNear(label, tagAt(90, 85), 4)).toBe(true);
  });

  it('counts boxes less than the gap apart as near', () => {
    expect(boxesAreNear(label, tagAt(90, 101), 4)).toBe(true);
  });

  it('counts boxes the gap or further apart as clear', () => {
    expect(boxesAreNear(label, tagAt(90, 102), 4)).toBe(false);
    expect(boxesAreNear(label, tagAt(160, 85), 4)).toBe(false);
  });
});

describe('LabelYield', () => {
  it('hides the label as soon as the tag comes near', () => {
    const labelYield = new LabelYield();
    expect(labelYield.update(label, tagAt(400, 400), 0)).toBe(false);
    expect(labelYield.update(label, tagAt(90, 85), 16)).toBe(true);
  });

  it('brings the label back only after the tag has been clear for the delay', () => {
    const labelYield = new LabelYield();
    labelYield.update(label, tagAt(90, 85), 1000);
    expect(labelYield.update(label, tagAt(400, 400), 1000 + RETURN_DELAY_MS - 1)).toBe(true);
    expect(labelYield.update(label, tagAt(400, 400), 1000 + RETURN_DELAY_MS)).toBe(false);
  });

  it('treats a hidden tag as clear', () => {
    const labelYield = new LabelYield();
    labelYield.update(label, tagAt(90, 85), 0);
    expect(labelYield.update(label, null, RETURN_DELAY_MS)).toBe(false);
  });
});
