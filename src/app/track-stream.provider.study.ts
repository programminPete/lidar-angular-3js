import type { Provider } from '@angular/core';
import { TrackStream } from './platform/data/track-stream';
import { SimulatedTrackStream } from './platform/data/simulated-track-stream';

/**
 * Simulation only, for the hosted study build: a public page must not let a URL
 * parameter point it at an arbitrary server, so the WebSocket client is left out.
 */
export function provideTrackStream(): Provider[] {
  return [{ provide: TrackStream, useClass: SimulatedTrackStream }];
}
