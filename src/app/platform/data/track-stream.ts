import type { Observable } from 'rxjs';
import type { ConnectionStatus, TrackFrame } from './track.model';

/**
 * The one boundary between the app and its data source. Also the DI token:
 * `app.config.ts` decides which implementation to provide.
 */
export abstract class TrackStream {
  /** About 10 frames per second. Shared: every subscriber sees the same frames. */
  abstract readonly frames$: Observable<TrackFrame>;
  abstract readonly status$: Observable<ConnectionStatus>;
}
