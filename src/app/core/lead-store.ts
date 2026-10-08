import { Injectable, effect, signal } from '@angular/core';
import { uid } from './util';

export interface Lead {
  id: string;
  pageId: string;
  pageTitle: string;
  /** Website slug the submission came from (older entries derive it from pageId). */
  website?: string;
  websiteName?: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
}

const STORAGE_KEY = 'cms.leads.v1';

/** Contact-form submissions from published landing pages. */
@Injectable({ providedIn: 'root' })
export class LeadStore {
  private readonly _leads = signal<Lead[]>(this.load());
  readonly leads = this._leads.asReadonly();

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._leads()));
      } catch {
        /* storage full; submissions stay in memory for this session */
      }
    });
  }

  add(lead: Omit<Lead, 'id' | 'createdAt'>): void {
    this._leads.update((l) => [{ ...lead, id: uid('l_'), createdAt: new Date().toISOString() }, ...l]);
  }

  remove(id: string): void {
    this._leads.update((l) => l.filter((x) => x.id !== id));
  }

  private load(): Lead[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Lead[];
    } catch {
      return [];
    }
  }
}
