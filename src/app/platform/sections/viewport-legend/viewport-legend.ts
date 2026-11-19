import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Explains the two marks in the viewport that are not self-evident: the door lanes and the orange people. */
@Component({
  selector: 'ow-viewport-legend',
  templateUrl: './viewport-legend.html',
  styleUrl: './viewport-legend.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewportLegend {}
