import { Injectable, computed, inject, signal } from '@angular/core';
import { api } from './api';
import { WebsiteStore } from './website-store';

export interface Submission {
  id: string;
  site: string; // website slug
  page: string;
  name: string;
  email: string;
  message: string;
  created_at: string;
}

/** Form submissions, stored server-side (SQLite) and scoped to the signed-in user. */
@Injectable({ providedIn: 'root' })
export class SubmissionStore {
  private readonly websites = inject(WebsiteStore);
  private readonly _list = signal<Submission[]>([]);

  readonly list = this._list.asReadonly();
  readonly count = computed(() => this._list().length);

  /** Loads the current user's submissions from the server. */
  async load(): Promise<void> {
    try {
      const { submissions } = await api<{ submissions: Submission[] }>('GET', '/api/submissions');
      this._list.set(submissions ?? []);
    } catch {
      this._list.set([]);
    }
  }

  async remove(id: string): Promise<void> {
    await api('DELETE', `/api/submissions/${id}`);
    this._list.update((l) => l.filter((s) => s.id !== id));
  }

  clear(): void {
    this._list.set([]);
  }

  /** Website display name for a submission (falls back to the slug). */
  websiteName(s: Submission): string {
    return this.websites.get(s.site)?.name ?? s.site ?? '—';
  }
}
