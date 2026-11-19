import { ChangeDetectionStrategy, Component, computed, inject, untracked } from '@angular/core';
import type { Track } from '../data/track.model';
import { PLATFORM_LAYOUT, type PlatformLayout } from '../data/platform-layout';
import { BREACHES_BEFORE_DEMO, isBreachShown } from '../metrics/breach-detector';
import { nearestDoorId } from '../metrics/platform-metrics';
import { formatTimeOnPlatform } from '../views/shared/time-on-platform';
import { PlatformStore } from '../state/platform-store';
import type { PlatformView } from '../state/platform-state.model';
import { ViewToggle } from '../sections/view-toggle/view-toggle';
import { ViewportLegend } from '../sections/viewport-legend/viewport-legend';
import { HourlyChart } from '../sections/hourly-chart/hourly-chart';
import { OccupancySummary } from '../sections/occupancy-summary/occupancy-summary';
import { DoorWaitingBars } from '../sections/door-waiting-bars/door-waiting-bars';
import { NextShuttle } from '../sections/next-shuttle/next-shuttle';
import { BreachAlert } from '../sections/breach-alert/breach-alert';
import { PlatformPlan } from '../views/platform-plan/platform-plan';
import { Platform3d } from '../views/platform-3d/platform-3d';

/** "Selected T-9134, on platform 3 min 10 s, nearest Door 2". */
function describeSelection(track: Track, clockMs: number, layout: PlatformLayout): string {
  const timeOnPlatform = formatTimeOnPlatform(clockMs - track.firstSeen);
  const doorId = nearestDoorId(track, layout);
  return `Selected ${track.id}, on platform ${timeOnPlatform}, nearest Door ${doorId}`;
}

@Component({
  selector: 'ow-platform-screen',
  imports: [
    ViewToggle,
    ViewportLegend,
    HourlyChart,
    OccupancySummary,
    DoorWaitingBars,
    NextShuttle,
    BreachAlert,
    PlatformPlan,
    Platform3d,
  ],
  templateUrl: './platform-screen.html',
  styleUrl: './platform-screen.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformScreen {
  private readonly store = inject(PlatformStore);

  protected readonly capacity = PLATFORM_LAYOUT.capacity;
  protected readonly view = this.store.view;
  protected readonly metrics = this.store.metrics;
  protected readonly breach = this.store.breach;
  protected readonly shuttle = this.store.shuttle;
  protected readonly hourly = this.store.hourly;
  protected readonly doorAdvice = this.store.doorAdvice;

  protected readonly isPlanView = computed(() => this.view() === 'plan');
  protected readonly isBreachShown = computed(() => isBreachShown(this.breach()));

  /**
   * Text for the breach live region. It changes only when a breach starts, is acknowledged or
   * fully ends: active and clearing read the same, so a count wobbling around capacity is quiet.
   */
  protected readonly breachAnnouncement = computed(() => {
    const breach = this.breach();
    if (isBreachShown(breach)) {
      return breach.acknowledged
        ? 'Capacity breach acknowledged.'
        : `Capacity breach: more than ${this.capacity} people on the platform.`;
    }
    const hasHadBreachThisSession = breach.breachesToday > BREACHES_BEFORE_DEMO;
    return hasHadBreachThisSession ? 'Capacity breach ended.' : '';
  });

  /** Text for the selection live region; empty when nothing is selected, so nothing is read at load. */
  protected readonly selectionAnnouncement = computed(() => {
    const selectedId = this.store.selectedTrackId();
    if (selectedId === null) {
      return '';
    }
    // Details are read once, when the selection changes, so the text does not change every frame.
    return untracked(() => {
      const track = this.store.selectedTrack();
      return track === null ? '' : describeSelection(track, this.store.clock(), PLATFORM_LAYOUT);
    });
  });

  protected showView(view: PlatformView): void {
    this.store.setView(view);
  }

  protected acknowledgeBreach(): void {
    this.store.acknowledgeBreach();
  }
}
