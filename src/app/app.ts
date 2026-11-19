import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PlatformStore } from './platform/state/platform-store';
import { TopBar } from './platform/sections/top-bar/top-bar';
import { PlatformScreen } from './platform/platform-screen/platform-screen';

@Component({
  selector: 'ow-root',
  imports: [TopBar, PlatformScreen],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly store = inject(PlatformStore);

  protected readonly connection = this.store.connection;
  protected readonly clock = this.store.clock;
}
