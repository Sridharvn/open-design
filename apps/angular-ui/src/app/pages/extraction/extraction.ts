import { Component } from '@angular/core';

@Component({
  selector: 'app-extraction',
  standalone: true,
  template: `
    <div class="card">
      <h2>Extraction</h2>
      <p>Configure and extract UI designs to angular components.</p>
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
export class ExtractionPage {}
