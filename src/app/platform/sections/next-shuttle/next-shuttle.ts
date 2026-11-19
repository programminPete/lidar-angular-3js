import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ShuttleStatus } from '../../data/track.model';

/** 35 → "0:35", 95 → "1:35". */
function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

@Component({
  selector: 'ow-next-shuttle',
  templateUrl: './next-shuttle.html',
  styleUrl: './next-shuttle.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NextShuttle {
  readonly shuttle = input.required<ShuttleStatus | null>();

  protected readonly phase = computed(() => this.shuttle()?.phase ?? null);
  protected readonly countdown = computed(() => formatMinutesSeconds(this.shuttle()?.arrivesInSeconds ?? 0));
  protected readonly spaceFor = computed(() => this.shuttle()?.spaceFor ?? 0);
}
