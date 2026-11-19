import type { Provider } from '@angular/core';
import { TrackStream } from './platform/data/track-stream';
import { SimulatedTrackStream } from './platform/data/simulated-track-stream';
import { TRACK_SERVER_URL, WebSocketTrackStream } from './platform/data/websocket-track-stream';

/**
 * Chooses the data source once, at startup: the in-browser simulator by default,
 * or the WebSocket track server when the page is opened with `?ws=ws://host:port`.
 * The `study` build replaces this file with `track-stream.provider.study.ts`.
 */
export function provideTrackStream(): Provider[] {
  const trackServerUrl = new URLSearchParams(window.location.search).get('ws');
  if (trackServerUrl) {
    return [
      { provide: TRACK_SERVER_URL, useValue: trackServerUrl },
      { provide: TrackStream, useClass: WebSocketTrackStream },
    ];
  }
  return [{ provide: TrackStream, useClass: SimulatedTrackStream }];
}
