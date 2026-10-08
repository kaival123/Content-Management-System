import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Submission, SubmissionStore } from '../../core/submission-store';
import { downloadFile } from '../../shared/files';
import { Icon } from '../../shared/icon';

function csvCell(value: string): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
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
        <button type="button" class="btn btn-secondary" [disabled]="!store.count()" (click)="exportCsv()">
          <app-icon name="download" /> Export CSV
        </button>
      </div>
    </header>

    @if (store.count()) {
      <div class="panel table-wrap">
        <table class="table">
          <thead>
            <tr><th>Received</th><th>Website</th><th>Page</th><th>Name</th><th>Email</th><th>Message</th><th></th></tr>
          </thead>
          <tbody>
            @for (s of store.list(); track s.id) {
              <tr>
                <td class="nowrap">{{ s.created_at | date: 'MMM d, h:mm a' }}</td>
                <td>{{ store.websiteName(s) }}</td>
                <td>{{ s.page || '—' }}</td>
                <td>{{ s.name }}</td>
                <td><a [href]="'mailto:' + s.email">{{ s.email }}</a></td>
                <td class="msg">{{ s.message }}</td>
                <td><button type="button" class="btn-icon danger" title="Delete" (click)="remove(s)"><app-icon name="trash" [size]="16" /></button></td>
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
  protected readonly store = inject(SubmissionStore);

  constructor() {
    void this.store.load();
  }

  protected remove(s: Submission): void {
    if (confirm(`Delete the submission from ${s.name || s.email}?`)) void this.store.remove(s.id);
  }

  protected exportCsv(): void {
    const rows = [['Received', 'Website', 'Page', 'Name', 'Email', 'Message']];
    for (const s of this.store.list()) rows.push([s.created_at, this.store.websiteName(s), s.page, s.name, s.email, s.message]);
    downloadFile('submissions.csv', rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  }
}
