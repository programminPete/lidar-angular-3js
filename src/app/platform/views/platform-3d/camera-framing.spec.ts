import { pointPixelsForViewHeight } from './camera-framing';

describe('pointPixelsForViewHeight', () => {
  it('keeps the full point size in a desktop-sized view', () => {
    expect(pointPixelsForViewHeight(1.3, 980)).toBe(1.3);
    expect(pointPixelsForViewHeight(1.3, 720)).toBe(1.3);
  });

  it('shrinks points in step with a smaller view', () => {
    expect(pointPixelsForViewHeight(1.3, 343)).toBeCloseTo(0.65, 2);
  });

  it('never goes below half a CSS pixel', () => {
    expect(pointPixelsForViewHeight(1.3, 120)).toBe(0.5);
  });
});
