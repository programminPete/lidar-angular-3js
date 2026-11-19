import { Service, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  Subject,
  distinctUntilChanged,
  map,
  merge,
  scan,
  share,
  shareReplay,
  startWith,
  withLatestFrom,
  type Observable,
} from 'rxjs';
import type { ConnectionStatus, ShuttleStatus, Track, TrackFrame } from '../data/track.model';
import type { FramePair, PlatformView, SelectionDirection } from './platform-state.model';
import { steppedSelectionId } from './selection-order';
import { readViewFromAddress, writeViewToAddress } from './view-url';
import { PLATFORM_LAYOUT } from '../data/platform-layout';
import { TrackStream } from '../data/track-stream';
import {
  INITIAL_BREACH_STATE,
  isBreachShown,
  nextBreachState,
  type BreachEvent,
  type BreachState,
} from '../metrics/breach-detector';
import {
  addFrameToHistory,
  createSeededHourlyHistory,
  toHourBuckets,
  type HourBucket,
} from '../metrics/hourly-history';
import {
  INITIAL_STABLE_DOOR_ADVICE,
  currentDoorAdvice,
  nextStableDoorAdvice,
  type DoorAdvice,
} from '../metrics/door-guidance';
import { computePlatformMetrics, type PlatformMetrics } from '../metrics/platform-metrics';

/** A frame with its metrics, computed once and shared by everything downstream. */
interface MeasuredFrame {
  frame: TrackFrame;
  metrics: PlatformMetrics;
}

function pairWithPreviousFrame(pair: FramePair | null, frame: TrackFrame): FramePair {
  return {
    previous: pair?.current ?? frame,
    current: frame,
    receivedAt: performance.now(),
  };
}

/**
 * Screen state for the platform. The only thing components talk to.
 *
 * Data flows one way: frames → metrics (once per frame) → breach and hourly history;
 * door advice uses the metrics plus the breach state.
 * RxJS does that stream work; signals hold what templates read.
 */
@Service()
export class PlatformStore {
  private readonly stream = inject(TrackStream);
  private readonly layout = PLATFORM_LAYOUT;
  private readonly acknowledgements$ = new Subject<void>();
  private latestFramePair: FramePair | null = null;

  // ---- Streams ------------------------------------------------------------------------------

  private readonly measuredFrames$: Observable<MeasuredFrame> = this.stream.frames$.pipe(
    map((frame) => ({ frame, metrics: computePlatformMetrics(frame.tracks, frame.shuttle, this.layout) })),
    share(),
  );

  private readonly breach$: Observable<BreachState> = merge(
    this.measuredFrames$.pipe(
      map(({ frame, metrics }): BreachEvent => ({
        kind: 'frame',
        t: frame.t,
        count: metrics.totalCount,
        capacity: metrics.capacity,
      })),
    ),
    this.acknowledgements$.pipe(map((): BreachEvent => ({ kind: 'acknowledge' }))),
  ).pipe(
    scan(nextBreachState, INITIAL_BREACH_STATE),
    startWith(INITIAL_BREACH_STATE),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly hourly$: Observable<HourBucket[]> = this.measuredFrames$.pipe(
    map(({ frame, metrics }) => ({ t: frame.t, count: metrics.totalCount })),
    scan(addFrameToHistory, createSeededHourlyHistory(this.layout)),
    map(toHourBuckets),
  );

  private readonly doorAdvice$: Observable<DoorAdvice | null> = this.measuredFrames$.pipe(
    withLatestFrom(this.breach$),
    map(([{ frame, metrics }, breach]) => ({
      t: frame.t,
      advice: currentDoorAdvice(metrics, frame.shuttle),
      breachShown: isBreachShown(breach),
    })),
    scan(nextStableDoorAdvice, INITIAL_STABLE_DOOR_ADVICE),
    map((state) => state.shown),
    distinctUntilChanged(),
  );

  private readonly framePairs$: Observable<FramePair> = this.stream.frames$.pipe(
    scan<TrackFrame, FramePair, null>(pairWithPreviousFrame, null),
  );

  // ---- Signals for templates ----------------------------------------------------------------

  private readonly selectedId = signal<string | null>(null);
  private readonly currentView = signal<PlatformView>(readViewFromAddress());
  private readonly measured = toSignal(this.measuredFrames$, { initialValue: null });

  readonly connection: Signal<ConnectionStatus> = toSignal(this.stream.status$, {
    initialValue: 'connecting',
  });
  /** Latest frame, for UI that updates at 10 Hz. */
  readonly frame: Signal<TrackFrame | null> = computed(() => this.measured()?.frame ?? null);
  readonly metrics: Signal<PlatformMetrics> = computed(
    () => this.measured()?.metrics ?? computePlatformMetrics([], null, this.layout),
  );
  readonly breach: Signal<BreachState> = toSignal(this.breach$, { initialValue: INITIAL_BREACH_STATE });
  readonly hourly: Signal<HourBucket[]> = toSignal(this.hourly$, {
    initialValue: toHourBuckets(createSeededHourlyHistory(this.layout)),
  });
  /** Which doors have room, held steady (see `door-guidance.ts`). Null when there is nothing to advise. */
  readonly doorAdvice: Signal<DoorAdvice | null> = toSignal(this.doorAdvice$, { initialValue: null });
  readonly selectedTrackId: Signal<string | null> = this.selectedId.asReadonly();
  readonly view: Signal<PlatformView> = this.currentView.asReadonly();

  /** Epoch ms of the latest frame on the demo clock; 0 before the first frame. */
  readonly clock: Signal<number> = computed(() => this.frame()?.t ?? 0);

  readonly shuttle: Signal<ShuttleStatus | null> = computed(() => this.frame()?.shuttle ?? null);

  /** Null when nothing is selected. Selection clears itself when the person leaves the platform. */
  readonly selectedTrack: Signal<Track | null> = computed(() => {
    const selectedId = this.selectedId();
    if (selectedId === null) {
      return null;
    }
    const tracks = this.frame()?.tracks ?? [];
    return tracks.find((track) => track.id === selectedId) ?? null;
  });

  constructor() {
    this.framePairs$.pipe(takeUntilDestroyed()).subscribe((pair) => {
      this.latestFramePair = pair;
    });
    this.stream.frames$.pipe(takeUntilDestroyed()).subscribe((frame) => {
      this.clearSelectionIfGone(frame);
    });
  }

  // ---- Actions ------------------------------------------------------------------------------

  selectTrack(id: string | null): void {
    this.selectedId.set(id);
  }

  /** Keyboard selection for both views: the next or previous person along the platform. */
  stepSelection(direction: SelectionDirection): void {
    const tracks = this.frame()?.tracks ?? [];
    this.selectedId.set(steppedSelectionId(tracks, this.selectedId(), direction));
  }

  setView(view: PlatformView): void {
    this.currentView.set(view);
    writeViewToAddress(view);
  }

  acknowledgeBreach(): void {
    this.acknowledgements$.next();
  }

  /**
   * For render loops that draw at 60 fps: the two most recent frames and when the latest arrived
   * (performance.now()), so a view can interpolate positions between 10 Hz frames.
   * A plain method rather than a signal because render loops poll it every animation frame and
   * need both frames together; they have no use for a reactive dependency.
   */
  framePair(): FramePair | null {
    return this.latestFramePair;
  }

  private clearSelectionIfGone(frame: TrackFrame): void {
    const selectedId = this.selectedId();
    if (selectedId === null) {
      return;
    }
    const isStillTracked = frame.tracks.some((track) => track.id === selectedId);
    if (!isStillTracked) {
      this.selectedId.set(null);
    }
  }
}
