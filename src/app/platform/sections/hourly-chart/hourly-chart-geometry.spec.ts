import type { HourBucket } from '../../metrics/hourly-history';
import { buildHourlyChart } from './hourly-chart-geometry';

function hourBucket(hour: number, average: number, peak: number, isCurrent = false): HourBucket {
  return { hour, average, peak, breached: peak > 120, isCurrent };
}

const HOURS = [hourBucket(5, 14, 26), hourBucket(6, 38, 66), hourBucket(7, 72, 104), hourBucket(8, 88, 122, true)];

describe('buildHourlyChart', () => {
  const chart = buildHourlyChart(HOURS, 120);

  it('draws one bar per hour, taller for busier hours', () => {
    expect(chart.bars.length).toBe(4);
    expect(chart.bars[2].averageHeight).toBeGreaterThan(chart.bars[1].averageHeight);
  });

  it('keeps every peak cap and the capacity line inside the plot', () => {
    for (const bar of chart.bars) {
      expect(bar.peakBackingY).toBeGreaterThanOrEqual(0);
    }
    expect(chart.capacityLabelY).toBeGreaterThan(0);
    expect(chart.capacityY).toBeLessThan(chart.baselineY);
  });

  it('marks breached and current hours', () => {
    expect(chart.bars.map((bar) => bar.isBreach)).toEqual([false, false, false, true]);
    expect(chart.bars[3].isCurrent).toBe(true);
  });

  it('labels every second hour from the first, plus the current hour', () => {
    expect(chart.bars.map((bar) => bar.tickLabel)).toEqual(['05:00', null, '07:00', '08:00']);
  });

  it('places bars by percentage so the chart stretches with its panel', () => {
    expect(chart.bars[0].x).toBe('8.000%');
    expect(chart.bars[0].width).toBe('9.000%');
  });

  it('keeps the same scale whatever the peaks, so bars never jump as the live hour grows', () => {
    const quieter = buildHourlyChart([hourBucket(5, 40, 60, true)], 120);
    const busier = buildHourlyChart([hourBucket(5, 40, 145, true)], 120);

    expect(busier.bars[0].averageTop).toBe(quieter.bars[0].averageTop);
    expect(busier.capacityY).toBe(quieter.capacityY);
  });

  it('keeps the Peak and Average labels apart', () => {
    const close = buildHourlyChart([hourBucket(9, 60, 62, true)], 120);

    expect(close.averageLabelY - close.peakLabelY).toBeGreaterThanOrEqual(16);
  });
});
