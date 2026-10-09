import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, api } from '../../core/api';
import { Icon } from '../../shared/icon';

interface DomainInfo {
  baseDomain: string;
  cnameTarget: string;
  hosts: { host: string; subdomain: boolean }[];
}

/**
 * Per-website domains: shows the automatic subdomain and lets the user connect their own
 * custom domain (with the CNAME to add). Published sites are served at any of these hosts.
 */
@Component({
  selector: 'app-domains',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    @if (info(); as d) {
      @if (subdomain(); as s) {
        <div class="dm-row">
          <span class="dm-label">Free subdomain</span>
          <a class="dm-host" [href]="'https://' + s" target="_blank" rel="noopener">{{ s }}</a>
        </div>
      } @else if (!d.baseDomain) {
        <p class="dm-hint">Subdomains turn on once the platform sets a base domain. Ask your admin.</p>
      }

      <p class="dm-label" style="margin-top:10px">Your own domain</p>
      @for (h of custom(); track h) {
        <div class="dm-row">
          <a class="dm-host" [href]="'https://' + h" target="_blank" rel="noopener">{{ h }}</a>
          <button type="button" class="dm-del" (click)="remove(h)" [attr.aria-label]="'Remove ' + h"><app-icon name="trash" [size]="13" /></button>
        </div>
      }

      <div class="dm-add">
        <input type="text" [(ngModel)]="newDomain" placeholder="www.yourbrand.com" autocomplete="off" (keydown.enter)="add()" />
        <button type="button" class="btn btn-sm btn-secondary" [disabled]="busy()" (click)="add()">Connect</button>
      </div>
      @if (error()) {
        <p class="dm-msg err">{{ error() }}</p>
      }
      @if (justAdded(); as h) {
        <div class="dm-cname">
          <p>Add this record at your domain provider, then it goes live (HTTPS is automatic):</p>
          <table>
            <tr><td>Type</td><td><code>CNAME</code></td></tr>
            <tr><td>Name</td><td><code>{{ h.startsWith('www.') ? 'www' : h.split('.')[0] }}</code></td></tr>
            <tr><td>Value</td><td><code>{{ d.cnameTarget || 'your platform host' }}</code></td></tr>
          </table>
          <p class="dm-note">For a root domain (no “www”), use an <strong>A record</strong> to your server's IP instead.</p>
        </div>
      }
    }
  `,
  styles: [
    `
      .dm-label {
        font-size: 12px;
        font-weight: 600;
        color: #64748b;
        margin: 0 0 6px;
      }
      .dm-hint {
        margin: 6px 0;
        font-size: 12px;
        color: #94a3b8;
      }
      .dm-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 10px;
        border: 1px solid var(--a-border);
        border-radius: 8px;
        margin-bottom: 6px;
        background: #fff;
      }
      .dm-host {
        font-size: 13px;
        font-weight: 600;
        color: var(--a-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dm-del {
        flex: none;
        border: 0;
        background: none;
        color: #dc2626;
        cursor: pointer;
      }
      .dm-add {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }
      .dm-add input {
        flex: 1;
        min-width: 0;
        padding: 7px 9px;
        border: 1px solid var(--a-border-strong);
        border-radius: 7px;
        font-size: 13px;
      }
      .dm-msg.err {
        margin: 8px 0 0;
        color: #b91c1c;
        font-size: 12px;
      }
      .dm-cname {
        margin-top: 10px;
        padding: 10px 12px;
        border: 1px dashed #c7d2fe;
        border-radius: 8px;
        background: #f5f3ff;
        font-size: 12px;
      }
      .dm-cname p {
        margin: 0 0 6px;
      }
      .dm-cname table {
        border-collapse: collapse;
      }
      .dm-cname td {
        padding: 2px 10px 2px 0;
      }
      .dm-cname code {
        background: #fff;
        padding: 1px 6px;
        border-radius: 4px;
      }
      .dm-note {
        margin-top: 6px !important;
        color: #64748b;
      }
    `,
  ],
})
export class Domains {
  readonly site = input.required<string>();
  private readonly _info = signal<DomainInfo | null>(null);

  readonly info = this._info.asReadonly();
  readonly busy = signal(false);
  readonly error = signal('');
  readonly justAdded = signal<string | null>(null);
  newDomain = '';

  subdomain = () => this._info()?.hosts.find((h) => h.subdomain)?.host ?? null;
  custom = () => (this._info()?.hosts ?? []).filter((h) => !h.subdomain).map((h) => h.host);

  constructor() {
    effect(() => {
      const s = this.site();
      if (s) void this.load(s);
    });
  }

  private async load(site: string): Promise<void> {
    try {
      this._info.set(await api<DomainInfo>('GET', `/api/websites/${site}/domains`));
    } catch {
      this._info.set({ baseDomain: '', cnameTarget: '', hosts: [] });
    }
  }

  async add(): Promise<void> {
    if (this.busy() || !this.newDomain.trim()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { host } = await api<{ host: string }>('POST', `/api/websites/${this.site()}/domains`, { domain: this.newDomain });
      this.newDomain = '';
      this.justAdded.set(host);
      await this.load(this.site());
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not connect the domain.');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(host: string): Promise<void> {
    this.error.set('');
    try {
      await api('DELETE', `/api/websites/${this.site()}/domains?host=${encodeURIComponent(host)}`);
      if (this.justAdded() === host) this.justAdded.set(null);
      await this.load(this.site());
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not remove the domain.');
    }
  }
}
