import type { HourBucket } from '../../metrics/hourly-history';

/**
 * Chart geometry. Horizontal positions are percentages of the plot width so the SVG stretches
 * with the panel without measuring it; vertical positions are pixels in a fixed-height SVG.
 */
export const CHART_HEIGHT = 124;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 102;
const TICK_BASELINE = 120;
/** Bar width as a share of its hour's slot. */
const BAR_SHARE_OF_SLOT = 0.36;
/**
 * People at the top of the plot. Fixed, so bars never jump as the live hour's peak grows;
 * it leaves room above capacity (120) for breach peaks and the capacity label.
 */
const PEOPLE_AT_TOP = 150;
/** Moves a text baseline down so the text sits centred on a line. */
const TEXT_CENTER_OFFSET = 4;
/** Baseline-to-baseline spacing for the stacked "Peak" and "Average" labels: an 11px line plus air. */
const MIN_SERIES_LABEL_GAP = 16;

export interface HourBar {
  hour: number;
  isBreach: boolean;
  isCurrent: boolean;
  x: string;
  width: string;
  averageTop: number;
  averageHeight: number;
  /** Top of the 2px peak cap. */
  peakCapY: number;
  /** Top of a page-coloured band under the cap that clears the capacity dashes around it. */
  peakBackingY: number;
  tickX: string;
  /** "07:00", or null on hours without a tick. */
  tickLabel: string | null;
}

export interface HourlyChartGeometry {
  bars: HourBar[];
  /** Right end of the baseline and the capacity line: the last bar's right edge. */
  plotRight: string;
  baselineY: number;
  capacityY: number;
  capacityLabelY: number;
  capacityLabel: string;
  tickLabelY: number;
  peakLabelY: number;
  averageLabelY: number;
}

export function buildHourlyChart(hours: readonly HourBucket[], capacity: number): HourlyChartGeometry {
  const yFor = (people: number) =>
    PLOT_BOTTOM - (Math.min(people, PEOPLE_AT_TOP) / PEOPLE_AT_TOP) * (PLOT_BOTTOM - PLOT_TOP);

  const slotWidth = 100 / Math.max(hours.length, 1);
  const barWidth = slotWidth * BAR_SHARE_OF_SLOT;
  const firstHour = hours[0]?.hour ?? 0;

  const bars = hours.map((bucket, index): HourBar => {
    const slotCenter = slotWidth * (index + 0.5);
    const averageTop = yFor(bucket.average);
    const isTickHour = (bucket.hour - firstHour) % 2 === 0 || bucket.isCurrent;
    return {
      hour: bucket.hour,
      isBreach: bucket.breached,
      isCurrent: bucket.isCurrent,
      x: percent(slotCenter - barWidth / 2),
      width: percent(barWidth),
      averageTop,
      averageHeight: PLOT_BOTTOM - averageTop,
      peakCapY: yFor(bucket.peak) - 1,
      peakBackingY: yFor(bucket.peak) - 2.5,
      tickX: percent(slotCenter),
      tickLabel: isTickHour ? formatHour(bucket.hour) : null,
    };
  });

  const lastBucket = hours[hours.length - 1];
  const capacityY = Math.round(yFor(capacity)) + 0.5;
  const peakLabelY = yFor(lastBucket?.peak ?? 0) + TEXT_CENTER_OFFSET;
  const averageLabelY = yFor(lastBucket?.average ?? 0) + TEXT_CENTER_OFFSET;

  return {
    bars,
    plotRight: percent(slotWidth * (hours.length - 0.5) + barWidth / 2),
    baselineY: PLOT_BOTTOM + 0.5,
    capacityY,
    capacityLabelY: capacityY - 7,
    capacityLabel: `Capacity ${capacity}`,
    tickLabelY: TICK_BASELINE,
    peakLabelY,
    averageLabelY: Math.max(averageLabelY, peakLabelY + MIN_SERIES_LABEL_GAP),
  };
}

function percent(value: number): string {
  return `${value.toFixed(3)}%`;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
