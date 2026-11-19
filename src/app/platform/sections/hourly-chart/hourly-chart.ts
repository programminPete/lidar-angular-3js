import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { HourBucket } from '../../metrics/hourly-history';
import { buildHourlyChart, CHART_HEIGHT } from './hourly-chart-geometry';

/** "Today by hour": average and peak per hour against capacity. The last bar is the hour in progress. */
@Component({
  selector: 'ow-hourly-chart',
  templateUrl: './hourly-chart.html',
  styleUrl: './hourly-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HourlyChart {
  readonly hours = input.required<HourBucket[]>();
  readonly capacity = input.required<number>();

  protected readonly chartHeight = CHART_HEIGHT;
  protected readonly chart = computed(() => buildHourlyChart(this.hours(), this.capacity()));
}
