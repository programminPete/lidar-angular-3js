import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { BreachState } from '../../metrics/breach-detector';
import type { DoorAdvice } from '../../metrics/door-guidance';
import { joinDoorIds, type PlatformMetrics } from '../../metrics/platform-metrics';

/** The recommendation, split so the door list ("doors 3 and 4") can be kept on one line in CSS. */
interface Recommendation {
  lead: string;
  doorList: string;
}

function recommendation(advice: DoorAdvice | null): Recommendation {
  if (advice === null) {
    return { lead: 'Recommended: spread passengers across all four doors', doorList: '' };
  }
  const doors = advice.quietDoorIds;
  const doorNoun = doors.length === 1 ? 'door' : 'doors';
  return { lead: 'Recommended: direct passengers to', doorList: `${doorNoun} ${joinDoorIds(doors)}` };
}

/** Shown while a breach is active or clearing; the parent removes it (with a fade) when the breach ends. */
@Component({
  selector: 'ow-breach-alert',
  imports: [DatePipe],
  templateUrl: './breach-alert.html',
  styleUrl: './breach-alert.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreachAlert {
  readonly breach = input.required<BreachState>();
  readonly metrics = input.required<PlatformMetrics>();
  /** The same steady advice the door bars show. */
  readonly advice = input.required<DoorAdvice | null>();
  readonly acknowledge = output<void>();

  protected readonly isAcknowledged = computed(() => this.breach().acknowledged);
  protected readonly isClearing = computed(() => this.breach().phase === 'clearing');
  /** Red only for an unacknowledged breach that is still over capacity. */
  protected readonly isCalm = computed(() => this.isAcknowledged() || this.isClearing());

  protected readonly title = computed(() => {
    const { totalCount, capacity } = this.metrics();
    if (this.isClearing()) {
      return `Back within capacity · ${totalCount} of ${capacity}`;
    }
    return `Capacity breach: ${totalCount} of ${capacity} for ${this.breach().durationSeconds} s`;
  });

  protected readonly breachLength = computed(() => `Breach length ${this.breach().durationSeconds} s`);

  protected readonly recommendation = computed(() => recommendation(this.advice()));

  protected readonly startedAt = computed(() => this.breach().startedAt ?? 0);

  protected acknowledgeBreach(): void {
    if (this.isAcknowledged()) {
      return;
    }
    this.acknowledge.emit();
  }
}
