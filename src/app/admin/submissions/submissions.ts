import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Lead, LeadStore } from '../../core/lead-store';
import { downloadFile } from '../../shared/files';
import { Icon } from '../../shared/icon';

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

@Component({
  selector: 'app-submissions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Icon],
  template: `
    <header class="adm-page-head">
      <div>
        <h1>Form submissions</h1>
        <p class="adm-sub">Messages sent through contact forms on your published pages.</p>
      </div>
      <div class="adm-head-actions">
        <button type="button" class="btn btn-secondary" [disabled]="!store.leads().length" (click)="exportCsv()">
          <app-icon name="download" /> Export CSV
        </button>
      </div>
    </header>

    @if (store.leads().length) {
      <div class="panel table-wrap">
        <table class="table">
          <thead>
            <tr><th>Received</th><th>Name</th><th>Email</th><th>Message</th><th>Page</th><th></th></tr>
          </thead>
          <tbody>
            @for (l of store.leads(); track l.id) {
              <tr>
                <td class="nowrap">{{ l.createdAt | date: 'MMM d, h:mm a' }}</td>
                <td>{{ l.name }}</td>
                <td><a [href]="'mailto:' + l.email">{{ l.email }}</a></td>
                <td class="msg">{{ l.message }}</td>
                <td>{{ l.pageTitle }}</td>
                <td><button type="button" class="btn-icon danger" title="Delete" (click)="remove(l)"><app-icon name="trash" [size]="16" /></button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="adm-empty">
        <h2>No submissions yet</h2>
        <p>Add a <strong>Contact form</strong> section to a page and publish it. Submissions will show up here.</p>
      </div>
    }
  `,
})
export class Submissions {
  protected readonly store = inject(LeadStore);

  protected remove(lead: Lead): void {
    if (confirm(`Delete the submission from ${lead.name || lead.email}?`)) this.store.remove(lead.id);
  }

  protected exportCsv(): void {
    const rows = [['Received', 'Name', 'Email', 'Message', 'Page']];
    for (const l of this.store.leads()) rows.push([l.createdAt, l.name, l.email, l.message, l.pageTitle]);
    downloadFile('submissions.csv', rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  }
}
