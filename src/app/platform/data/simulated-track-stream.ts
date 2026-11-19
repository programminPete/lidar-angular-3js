import { Service } from '@angular/core';
import { interval, map, of, share, type Observable } from 'rxjs';
import { FRAME_INTERVAL_MS, type ConnectionStatus, type TrackFrame } from './track.model';
import { PlatformSimulator } from './simulation/platform-simulator';
import { TrackStream } from './track-stream';

const SIMULATION_SEED = 20261117;

/** Runs the simulator in the browser. Used unless the page is opened with `?ws=`. */
@Service({ autoProvided: false })
export class SimulatedTrackStream extends TrackStream {
  private readonly simulator = new PlatformSimulator(SIMULATION_SEED);

  readonly frames$: Observable<TrackFrame> = interval(FRAME_INTERVAL_MS).pipe(
    map(() => this.simulator.step(FRAME_INTERVAL_MS / 1000)),
    share(),
  );

  readonly status$: Observable<ConnectionStatus> = of('live');
}
