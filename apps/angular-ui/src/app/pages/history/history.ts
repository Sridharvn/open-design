import { Component } from '@angular/core';

@Component({
  selector: 'app-history',
  standalone: true,
  template: `
    <div class="card">
      <h2>History</h2>
      <p>View previous extraction runs and outputs.</p>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
    h2 {
      margin-bottom: var(--app-spacing-2);
    }
  `]
})
export class HistoryPage {}
