import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, api } from '../../core/api';

interface EmailSettings {
  provider: '' | 'smtp' | 'resend' | 'sendgrid';
  from: string;
  hasApiKey: boolean;
  smtp: { host: string; port: number; secure: boolean; user: string; hasPassword: boolean };
}

/**
 * Platform Settings (admin only): the ONE email sender for the whole platform. Pick SMTP
 * (your own email account) or an API provider (Resend/SendGrid). Stored in the database
 * and applied immediately — no code change, no redeploy.
 */
@Component({
  selector: 'app-platform-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="ps">
      <h1>Platform settings</h1>

      <section class="ps-card">
        <div class="ps-head">
          <h2>Email provider</h2>
          <span class="ps-status" [class.on]="active()">{{ active() ? 'Active' : 'Not configured' }}</span>
        </div>
        <p class="ps-hint">
          Set this once. It sends the form-submission notifications for <strong>every</strong> website — each to that site's
          own “Send form submissions to” address. Users never configure email themselves.
        </p>

        <form (ngSubmit)="save()">
          <label>
            Provider
            <select name="provider" [(ngModel)]="provider">
              <option value="">Off</option>
              <option value="smtp">My own email (SMTP)</option>
              <option value="resend">Resend</option>
              <option value="sendgrid">SendGrid</option>
            </select>
          </label>

          @if (provider === 'resend' || provider === 'sendgrid') {
            <label>
              API key
              <input type="password" name="apiKey" [(ngModel)]="apiKey" [placeholder]="hasApiKey() ? '•••••••• (saved — leave blank to keep)' : 'your provider API key'" autocomplete="new-password" />
            </label>
          }

          @if (provider === 'smtp') {
            <label>
              SMTP host
              <input type="text" name="host" [(ngModel)]="host" placeholder="smtp.gmail.com" autocomplete="off" />
            </label>
            <div class="ps-row">
              <label class="ps-port">
                Port
                <input type="number" name="port" [(ngModel)]="port" placeholder="587" />
              </label>
              <label class="ps-check"><input type="checkbox" name="secure" [(ngModel)]="secure" /> SSL (port 465)</label>
            </div>
            <label>
              Username (your email)
              <input type="email" name="user" [(ngModel)]="user" placeholder="you@gmail.com" autocomplete="off" />
            </label>
            <label>
              Password / app password
              <input type="password" name="pass" [(ngModel)]="pass" [placeholder]="hasPassword() ? '•••••••• (saved — leave blank to keep)' : 'app password'" autocomplete="new-password" />
            </label>
          }

          @if (provider) {
            <label>
              From address
              <input type="text" name="from" [(ngModel)]="from" placeholder="CMS &lt;no-reply@yourdomain.com&gt;" autocomplete="off" />
            </label>
          }

          @if (msg(); as m) {
            <p class="ps-msg" [class.err]="m.err">{{ m.text }}</p>
          }
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
        </form>
      </section>
    </div>
  `,
  styles: [
    `
      .ps {
        max-width: 620px;
        padding: 24px;
      }
      h1 {
        margin: 0 0 20px;
      }
      .ps-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 22px 24px;
      }
      .ps-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .ps-head h2 {
        margin: 0;
        font-size: 1.05rem;
      }
      .ps-status {
        padding: 2px 10px;
        border-radius: 999px;
        background: #f1f5f9;
        color: #64748b;
        font-size: 0.72rem;
        font-weight: 700;
      }
      .ps-status.on {
        background: #ecfdf3;
        color: #067647;
      }
      .ps-hint {
        margin: 0 0 18px;
        color: #64748b;
        font-size: 0.9rem;
        line-height: 1.55;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        color: #334155;
      }
      select,
      input[type='text'],
      input[type='email'],
      input[type='password'],
      input[type='number'] {
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        font-size: 1rem;
        font-family: inherit;
      }
      select:focus,
      input:focus {
        outline: 2px solid #4f46e5;
        border-color: #4f46e5;
      }
      .ps-row {
        display: flex;
        align-items: end;
        gap: 16px;
      }
      .ps-port {
        width: 110px;
      }
      .ps-check {
        flex-direction: row;
        align-items: center;
        gap: 8px;
        font-weight: 500;
        padding-bottom: 10px;
      }
      .ps-check input {
        width: auto;
      }
      .ps-msg {
        margin: 0;
        padding: 10px 12px;
        border-radius: 10px;
        font-size: 0.85rem;
        background: #f0fdf4;
        color: #15803d;
      }
      .ps-msg.err {
        background: #fef2f2;
        color: #b91c1c;
      }
      .btn {
        align-self: flex-start;
        padding: 10px 18px;
        border: none;
        border-radius: 10px;
        font-weight: 700;
        cursor: pointer;
      }
      .btn-primary {
        background: #4f46e5;
        color: #fff;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: default;
      }
    `,
  ],
})
export class PlatformSettings {
  provider: '' | 'smtp' | 'resend' | 'sendgrid' = '';
  from = '';
  apiKey = '';
  host = '';
  port = 587;
  secure = false;
  user = '';
  pass = '';
  protected readonly hasApiKey = signal(false);
  protected readonly hasPassword = signal(false);
  protected readonly active = signal(false);
  protected readonly busy = signal(false);
  protected readonly msg = signal<{ text: string; err: boolean } | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const { email, active } = await api<{ email: EmailSettings; active: boolean }>('GET', '/api/admin/settings');
      this.provider = email.provider;
      this.from = email.from;
      this.hasApiKey.set(email.hasApiKey);
      this.host = email.smtp.host;
      this.port = email.smtp.port || 587;
      this.secure = email.smtp.secure;
      this.user = email.smtp.user;
      this.hasPassword.set(email.smtp.hasPassword);
      this.apiKey = '';
      this.pass = '';
      this.active.set(active);
    } catch (e) {
      this.msg.set({ text: e instanceof ApiError ? e.message : 'Could not load settings.', err: true });
    }
  }

  async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.msg.set(null);
    try {
      const { active } = await api<{ active: boolean }>('PUT', '/api/admin/settings', {
        provider: this.provider,
        from: this.from,
        apiKey: this.apiKey,
        smtp: { host: this.host, port: this.port, secure: this.secure, user: this.user, pass: this.pass },
      });
      this.active.set(active);
      if (this.apiKey.trim()) this.hasApiKey.set(true);
      if (this.pass.trim()) this.hasPassword.set(true);
      this.apiKey = '';
      this.pass = '';
      this.msg.set({ text: active ? 'Saved. Email is now active for all websites.' : 'Saved. Email is off (fill in all fields to activate).', err: false });
    } catch (e) {
      this.msg.set({ text: e instanceof ApiError ? e.message : 'Could not save.', err: true });
    } finally {
      this.busy.set(false);
    }
  }
}
