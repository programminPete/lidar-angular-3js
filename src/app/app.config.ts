import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideTrackStream } from './track-stream.provider';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideTrackStream()],
};
