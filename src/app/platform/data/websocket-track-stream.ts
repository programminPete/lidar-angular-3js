import { InjectionToken, Service, inject } from '@angular/core';
import { BehaviorSubject, concatWith, defer, retry, share, throwError, timer, type Observable } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import type { ConnectionStatus, TrackFrame } from './track.model';
import { TrackStream } from './track-stream';

/** Address of the track server, for example `ws://localhost:8787`. */
export const TRACK_SERVER_URL = new InjectionToken<string>('TRACK_SERVER_URL');

const FIRST_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8000;

/** Attempt 1 waits 500 ms, then 1 s, 2 s, 4 s, and 8 s for every later attempt. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

/**
 * Receives JSON frames from `server/track-server.ts` and reconnects with capped exponential backoff.
 * The backoff resets only once frames flow again, so a server that accepts and then drops
 * connections is retried ever more slowly rather than every 500 ms.
 */
@Service({ autoProvided: false })
export class WebSocketTrackStream extends TrackStream {
  private readonly url = inject(TRACK_SERVER_URL);
  private readonly status = new BehaviorSubject<ConnectionStatus>('connecting');

  readonly status$: Observable<ConnectionStatus> = this.status.asObservable();

  readonly frames$: Observable<TrackFrame> = defer(() => this.openSocket()).pipe(
    retry({ delay: (_error, attempt) => timer(reconnectDelayMs(attempt)), resetOnSuccess: true }),
    share(),
  );

  /** Frames from one connection. Ends in an error however the connection closes, so `retry` handles every drop. */
  private openSocket(): Observable<TrackFrame> {
    const socket = webSocket<TrackFrame>({
      url: this.url,
      openObserver: { next: () => this.status.next('live') },
      closeObserver: { next: () => this.status.next('reconnecting') },
    });
    const closedCleanly = throwError(() => new Error('Track server closed the connection'));
    return socket.pipe(concatWith(closedCleanly));
  }
}
