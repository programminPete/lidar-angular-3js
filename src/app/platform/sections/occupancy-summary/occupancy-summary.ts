import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CROWDED_PERCENT, type PlatformMetrics } from '../../metrics/platform-metrics';

const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface RingDashes {
  /** stroke-dasharray for the arc up to 100%. */
  fill: string;
  /** stroke-dasharray for the arc past 100%, drawn again from 12 o'clock. */
  overflow: string;
  hasOverflow: boolean;
}

function ringDashes(fractionOfCapacity: number): RingDashes {
  const fillFraction = Math.min(Math.max(fractionOfCapacity, 0), 1);
  const overflowFraction = Math.min(Math.max(fractionOfCapacity - 1, 0), 1);
  return {
    fill: `${fillFraction * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`,
    overflow: `${overflowFraction * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`,
    hasOverflow: overflowFraction > 0,
  };
}

@Component({
  selector: 'ow-occupancy-summary',
  templateUrl: './occupancy-summary.html',
  styleUrl: './occupancy-summary.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OccupancySummary {
  readonly metrics = input.required<PlatformMetrics>();
  readonly breachesToday = input.required<number>();

  protected readonly ringRadius = RING_RADIUS;

  protected readonly isNearCapacity = computed(() => this.metrics().percentFull >= CROWDED_PERCENT);

  protected readonly ring = computed(() => {
    const { totalCount, capacity } = this.metrics();
    return ringDashes(totalCount / capacity);
  });

  protected readonly breachesLabel = computed(() => {
    const count = this.breachesToday();
    const noun = count === 1 ? 'breach' : 'breaches';
    return `${count} ${noun} today`;
  });
}
