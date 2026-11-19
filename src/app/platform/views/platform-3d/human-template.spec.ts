import { HUMAN_POINT_COUNT, createHumanTemplates, templateIndexForTrackId } from './human-template';

describe('human template', () => {
  it('has between 260 and 320 points per person', () => {
    expect(HUMAN_POINT_COUNT).toBeGreaterThanOrEqual(260);
    expect(HUMAN_POINT_COUNT).toBeLessThanOrEqual(320);
  });

  it('fills every point of every template', () => {
    for (const template of createHumanTemplates(1)) {
      expect(template.positions.length).toBe(HUMAN_POINT_COUNT * 3);
      expect(template.brightness.length).toBe(HUMAN_POINT_COUNT);
      expect(template.brightness.every((value) => value > 0)).toBe(true);
    }
  });

  it('stands on the floor at about 1.6 to 1.9 metres tall', () => {
    for (const template of createHumanTemplates(1)) {
      const heights = template.positions.filter((_, index) => index % 3 === 2);
      const tallest = Math.max(...heights);
      expect(Math.min(...heights)).toBeGreaterThan(-0.05);
      expect(tallest).toBeGreaterThan(1.55);
      expect(tallest).toBeLessThan(1.95);
    }
  });

  it('stays within a person-sized footprint', () => {
    for (const template of createHumanTemplates(1)) {
      const sideways = template.positions.filter((_, index) => index % 3 === 1);
      expect(Math.max(...sideways.map(Math.abs))).toBeLessThan(0.4);
    }
  });

  it('builds the same templates from the same seed', () => {
    expect(createHumanTemplates(5)).toEqual(createHumanTemplates(5));
  });

  it('gives a track the same template every time', () => {
    const first = templateIndexForTrackId('T-9134', 6);
    expect(templateIndexForTrackId('T-9134', 6)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(6);
  });

  it('spreads tracks across the templates', () => {
    const used = new Set<number>();
    for (let number = 1000; number < 1100; number++) {
      used.add(templateIndexForTrackId(`T-${number}`, 6));
    }
    expect(used.size).toBe(6);
  });
});
