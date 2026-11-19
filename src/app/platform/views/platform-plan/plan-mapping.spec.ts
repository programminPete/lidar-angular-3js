import {
  fitWorldToViewport,
  projectPeople,
  toScreenVelocity,
  toScreenX,
  toScreenY,
  type Margins,
} from './plan-mapping';

const NO_MARGINS: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

describe('fitWorldToViewport', () => {
  it('fits the width when the viewport is relatively taller than the world', () => {
    const mapping = fitWorldToViewport({ x: 0, y: 0, width: 40, height: 10 }, { width: 400, height: 400 }, NO_MARGINS);

    expect(mapping.scale).toBe(10);
  });

  it('fits the height when the viewport is relatively wider than the world', () => {
    const mapping = fitWorldToViewport({ x: 0, y: 0, width: 40, height: 10 }, { width: 1000, height: 50 }, NO_MARGINS);

    expect(mapping.scale).toBe(5);
  });

  it('flips y so the far edge of the world is at the top, and centres the drawing', () => {
    const mapping = fitWorldToViewport({ x: 0, y: 0, width: 40, height: 10 }, { width: 400, height: 300 }, NO_MARGINS);

    // Drawing is 400 × 100, centred in 300 px of height: top at 100, bottom at 200.
    expect([toScreenX(mapping, 0), toScreenY(mapping, 10)]).toEqual([0, 100]);
    expect([toScreenX(mapping, 40), toScreenY(mapping, 0)]).toEqual([400, 200]);
  });

  it('keeps the margins clear and handles a world that does not start at the origin', () => {
    const margins = { top: 60, right: 20, bottom: 40, left: 20 };
    const world = { x: -2, y: -1, width: 20, height: 10 };

    const mapping = fitWorldToViewport(world, { width: 240, height: 200 }, margins);

    expect(mapping.scale).toBe(10);
    // The world's top-left corner (x = -2, y = 9) lands on the top-left of the free area.
    expect([toScreenX(mapping, -2), toScreenY(mapping, 9)]).toEqual([20, 60]);
  });

  it('never produces a zero or negative scale for an unmeasured viewport', () => {
    const mapping = fitWorldToViewport({ x: 0, y: 0, width: 40, height: 10 }, { width: 0, height: 0 }, NO_MARGINS);

    expect(mapping.scale).toBeGreaterThan(0);
  });
});

describe('toScreenVelocity', () => {
  it('scales metres per second to pixels per second and points +y up the screen', () => {
    const mapping = { scale: 10, originX: 0, originY: 0 };
    const out = { x: 0, y: 0 };

    const velocity = toScreenVelocity(mapping, Math.PI / 2, 1.5, out);

    expect(velocity).toBe(out);
    expect(velocity.x).toBeCloseTo(0);
    expect(velocity.y).toBeCloseTo(-15);
  });
});

describe('projectPeople', () => {
  it('reuses the pooled points, grows the pool, and returns how many are current', () => {
    const mapping = { scale: 10, originX: 5, originY: 100 };
    const pool = [{ id: 'old', x: 0, y: 0 }];
    const first = pool[0];

    const count = projectPeople(mapping, [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 0 }], pool);

    expect(count).toBe(2);
    expect(pool[0]).toBe(first);
    expect(pool.slice(0, 2)).toEqual([{ id: 'a', x: 15, y: 80 }, { id: 'b', x: 35, y: 100 }]);
  });
});
