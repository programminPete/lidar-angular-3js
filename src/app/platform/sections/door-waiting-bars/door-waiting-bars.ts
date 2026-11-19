import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import type { DoorAdvice } from '../../metrics/door-guidance';
import { CROWDED_PERCENT, joinDoorIds, type DoorCount, type PlatformMetrics } from '../../metrics/platform-metrics';

// Chart geometry in SVG user units (the SVG is drawn at 1:1 pixels).
const BAR_START_X = 56;
const BAR_END_X = 280;
const FIRST_ROW_TOP = 22;
const ROW_HEIGHT = 24;
const BAR_HEIGHT = 6;
/** The bar scale never drops below this many people, so short bars stay comparable. */
const MIN_SCALE_PEOPLE = 50;

interface DoorBarRow {
  label: string;
  count: number;
  /** Orange: over even share while the platform is crowded. Teal otherwise. */
  isWatch: boolean;
  /** Top edge of the bar. */
  barY: number;
  /** Baseline for the row's label and count. */
  textY: number;
  barWidth: number;
}

function scaleMaximum(doors: readonly DoorCount[]): number {
  const largestCount = Math.max(0, ...doors.map((door) => door.count));
  return Math.max(MIN_SCALE_PEOPLE, Math.ceil(largestCount / 10) * 10);
}

function roomSentence(advice: DoorAdvice): string {
  const doors = advice.quietDoorIds;
  const subject = doors.length === 1 ? `Door ${doors[0]} has` : `Doors ${joinDoorIds(doors)} have`;
  return `${subject} room for about ${advice.roomForPeople} more people.`;
}

@Component({
  selector: 'ow-door-waiting-bars',
  templateUrl: './door-waiting-bars.html',
  styleUrl: './door-waiting-bars.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DoorWaitingBars {
  readonly metrics = input.required<PlatformMetrics>();
  /** Steady advice from the store; null closes the sentence. */
  readonly advice = input.required<DoorAdvice | null>();

  protected readonly barStartX = BAR_START_X;
  protected readonly barTrackWidth = BAR_END_X - BAR_START_X;
  protected readonly barHeight = BAR_HEIGHT;
  protected readonly markerTop = FIRST_ROW_TOP - 2;
  protected readonly markerBottom = FIRST_ROW_TOP + ROW_HEIGHT * 4;
  protected readonly markerLabelY = FIRST_ROW_TOP - 8;

  private readonly peoplePerUnit = computed(() => scaleMaximum(this.metrics().waitingByDoor) / this.barTrackWidth);
  private readonly isCrowded = computed(() => this.metrics().percentFull >= CROWDED_PERCENT);

  protected readonly rows = computed<DoorBarRow[]>(() => {
    const peoplePerUnit = this.peoplePerUnit();
    const isCrowded = this.isCrowded();
    return this.metrics().waitingByDoor.map((door, index) => {
      const rowCenterY = FIRST_ROW_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2;
      return {
        label: door.label,
        count: door.count,
        isWatch: isCrowded && door.aboveEvenShare,
        barY: rowCenterY - BAR_HEIGHT / 2,
        textY: rowCenterY + 4,
        barWidth: door.count / peoplePerUnit,
      };
    });
  });

  /** x of the even-share marker, snapped to a half pixel so the 1px dashed line stays crisp. */
  protected readonly evenShareX = computed(() => {
    const offset = this.metrics().evenShare / this.peoplePerUnit();
    return Math.round(BAR_START_X + offset) + 0.5;
  });

  private readonly roundedEvenShare = computed(() => Math.round(this.metrics().evenShare));

  protected readonly evenShareLabel = computed(() => `Even share ${this.roundedEvenShare()}`);

  /** The chart is one image to assistive tech, so its label carries the actual numbers. */
  protected readonly chartLabel = computed(() => {
    const doorCounts = this.metrics().waitingByDoor.map((door) => `${door.label}: ${door.count}`);
    return `People waiting by door. ${doorCounts.join(', ')}. Even share ${this.roundedEvenShare()}.`;
  });

  protected readonly hasAdvice = computed(() => this.advice() !== null);

  /** Keeps the last sentence while the line animates closed, so it does not go blank mid-close. */
  protected readonly roomAtQuietDoors = linkedSignal<DoorAdvice | null, string>({
    source: this.advice,
    computation: (advice, previous) => (advice === null ? (previous?.value ?? '') : roomSentence(advice)),
  });
}
