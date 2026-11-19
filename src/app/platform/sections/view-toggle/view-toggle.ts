import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { PlatformView } from '../../state/platform-state.model';

@Component({
  selector: 'ow-view-toggle',
  templateUrl: './view-toggle.html',
  styleUrl: './view-toggle.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewToggle {
  readonly view = input.required<PlatformView>();
  readonly viewChange = output<PlatformView>();

  protected readonly isPlan = computed(() => this.view() === 'plan');
  protected readonly is3d = computed(() => this.view() === '3d');

  protected choose(view: PlatformView): void {
    this.viewChange.emit(view);
  }
}
