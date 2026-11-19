import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { ConnectionStatus } from '../../data/track.model';
import { PLATFORM_LAYOUT } from '../../data/platform-layout';

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  live: 'Live · 10 Hz',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
};

@Component({
  selector: 'ow-top-bar',
  imports: [DatePipe],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopBar {
  readonly connection = input.required<ConnectionStatus>();
  /** Epoch ms on the demo clock; 0 before the first frame. */
  readonly clock = input.required<number>();

  protected readonly siteName = PLATFORM_LAYOUT.name;
  protected readonly isLive = computed(() => this.connection() === 'live');
  protected readonly connectionLabel = computed(() => CONNECTION_LABELS[this.connection()]);
  protected readonly hasClock = computed(() => this.clock() > 0);
}
