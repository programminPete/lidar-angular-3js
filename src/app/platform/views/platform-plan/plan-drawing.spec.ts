import { PLATFORM_LAYOUT } from '../../data/platform-layout';
import { buildPlanDrawing, planWorldBounds } from './plan-drawing';
import { fitWorldToViewport } from './plan-mapping';

describe('buildPlanDrawing', () => {
  const margins = { top: 0, right: 0, bottom: 0, left: 0 };
  const mapping = fitWorldToViewport(planWorldBounds(PLATFORM_LAYOUT), { width: 1000, height: 1000 }, margins);
  const drawing = buildPlanDrawing(PLATFORM_LAYOUT, mapping);

  it('fits the platform and the shuttle cars, so both are centred together', () => {
    const bounds = planWorldBounds(PLATFORM_LAYOUT);
    const carsTop = Math.max(...PLATFORM_LAYOUT.shuttleCars.map((car) => car.outline.y + car.outline.height));

    expect(bounds.y + bounds.height).toBe(carsTop);
  });

  it('draws one labelled door and keep-clear area per door, and a wall piece between each pair', () => {
    expect(drawing.doors.map((door) => door.label)).toEqual(['Door 1', 'Door 2', 'Door 3', 'Door 4']);
    expect(drawing.doorWallPieces.length).toBe(PLATFORM_LAYOUT.doors.length - 1);
  });

  it('draws the shuttle above the door wall on screen', () => {
    const doorWallScreenY = drawing.doors[0].opening.y;

    for (const car of drawing.cars) {
      expect(car.outline.y + car.outline.height).toBeLessThan(doorWallScreenY);
    }
  });

  it('sizes the scale bar from the mapping', () => {
    expect(drawing.scaleBarWidth).toBe(Math.round(5 * mapping.scale));
  });
});
