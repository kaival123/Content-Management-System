import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, api } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { Icon } from '../../shared/icon';
import { Role, RoleSelect } from './role-select';

interface ManagedUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
}

/** Admin screen: list, create, promote/demote and delete accounts. */
@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, Icon, RoleSelect],
  template: `
    <div class="um">
      <header class="um-head">
        <h1>User management</h1>
        <p>Add the people who can sign in to the CMS and choose what each of them can do.</p>
      </header>

      <section class="um-card">
        <div class="um-card-head">
          <h2>Add a user</h2>
          <span class="um-hint">They can change their password after signing in.</span>
        </div>
        <form class="um-new" (ngSubmit)="create()">
          <div class="um-field um-field-grow">
            <label for="um-email">Email</label>
            <input id="um-email" type="email" name="email" placeholder="name@company.com" autocomplete="off" [(ngModel)]="email" required />
          </div>
          <div class="um-field um-field-grow">
            <label for="um-password">Temporary password</label>
            <input id="um-password" type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" [(ngModel)]="password" required />
          </div>
          <div class="um-field">
            <span class="um-label">Role</span>
            <app-role-select variant="field" label="Role for the new user" [value]="role" (changed)="role = $event" />
          </div>
          <button type="submit" class="um-add" [disabled]="busy()">
            <app-icon name="plus" [size]="16" /> {{ busy() ? 'Adding…' : 'Add user' }}
          </button>
        </form>
        @if (error()) {
          <p class="um-msg err" role="alert">{{ error() }}</p>
        }
      </section>

      <section class="um-card um-card-flush">
        <div class="um-card-head um-pad">
          <h2>Accounts <span class="um-count">{{ users().length }}</span></h2>
        </div>
        <div class="um-scroll">
          <table class="um-table">
            <thead>
              <tr><th>User</th><th>Role</th><th>Created</th><th class="um-right">Actions</th></tr>
            </thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr>
                  <td>
                    <div class="um-user">
                      <span class="um-avatar" [class.um-avatar-admin]="u.role === 'admin'" aria-hidden="true">{{ u.email.charAt(0).toUpperCase() }}</span>
                      <span class="um-email">{{ u.email }}</span>
                      @if (u.id === auth.user()?.id) {
                        <span class="um-you">You</span>
                      }
                    </div>
                  </td>
                  <td>
                    <app-role-select
                      [value]="u.role"
                      [label]="'Role of ' + u.email"
                      [disabled]="u.id === auth.user()?.id"
                      disabledHint="You cannot change your own role"
                      (changed)="askRole(u, $event)"
                    />
                  </td>
                  <td class="um-date">{{ u.created_at | date: 'd MMM y' }}</td>
                  <td class="um-right">
                    @if (u.id !== auth.user()?.id) {
                      <button type="button" class="um-del" (click)="remove(u)" [attr.aria-label]="'Delete ' + u.email">
                        <app-icon name="trash" [size]="14" /> Delete
                      </button>
                    } @else {
                      <span class="um-dash">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="um-empty">No accounts yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    @if (pending(); as p) {
      <div class="modal-backdrop" (click)="cancelRole()"></div>
      <div class="modal um-confirm" role="alertdialog" aria-modal="true" aria-labelledby="um-confirm-title" aria-describedby="um-confirm-text">
        <header class="modal-head">
          <h2 id="um-confirm-title">Change role?</h2>
        </header>
        <div class="modal-body">
          <p id="um-confirm-text">
            Change <strong>{{ p.user.email }}</strong> from <strong>{{ label(p.user.role) }}</strong> to <strong>{{ label(p.role) }}</strong>?
          </p>
          <p class="um-note">
            {{ p.role === 'admin' ? 'They will be able to add, change and delete accounts.' : 'They will no longer be able to manage accounts.' }}
          </p>
        </div>
        <footer class="modal-foot">
          <button type="button" class="um-btn um-btn-ghost" (click)="cancelRole()" [disabled]="saving()">No</button>
          <button type="button" class="um-btn um-btn-primary" (click)="confirmRole()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Yes' }}</button>
        </footer>
      </div>
    }
  `,
  host: { '(document:keydown.escape)': 'cancelRole()' },
  styles: [
    `

      /* Mobile first: the base rules are the phone layout; wider screens add to them. */
      .um {
        width: 100%;
        color: #0f172a;
      }
      .um-head {
        margin-bottom: 18px;
      }
      .um-head h1 {
        margin: 0 0 6px;
        font-size: 1.4rem;
        letter-spacing: -0.02em;
      }
      .um-head p {
        margin: 0;
        color: #64748b;
        font-size: 0.9rem;
      }

      /* cards */
      .um-card {
        margin-bottom: 16px;
        padding: 16px;
        border: 1px solid #e5e9f0;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
      }
      .um-card-flush {
        padding: 0;
        overflow: hidden;
      }
      .um-card-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 4px 12px;
        margin-bottom: 14px;
      }
      .um-pad {
        margin: 0;
        padding: 16px 16px 12px;
      }
      .um-card h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }
      .um-hint {
        color: #94a3b8;
        font-size: 0.8rem;
      }
      .um-count {
        margin-left: 8px;
        padding: 2px 9px;
        border-radius: 999px;
        background: #eef2ff;
        color: #4f46e5;
        font-size: 0.75rem;
        font-weight: 700;
        vertical-align: middle;
      }

      /* add form: one column on phones */
      .um-new {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }
      .um-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .um-field label,
      .um-label {
        color: #475569;
        font-size: 0.78rem;
        font-weight: 600;
      }
      .um-field input {
        width: 100%;
        height: 44px;
        padding: 0 12px;
        border: 1px solid #d5dbe5;
        border-radius: 10px;
        background: #fff;
        color: #0f172a;
        font: inherit;
        font-size: 1rem; /* 16px keeps iOS from zooming into the field */
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .um-field input::placeholder {
        color: #a3adbd;
      }
      .um-field input:focus {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgb(99 102 241 / 18%);
      }
      .um-add {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 44px;
        padding: 0 20px;
        border: 0;
        border-radius: 10px;
        background: #4f46e5;
        color: #fff;
        font: inherit;
        font-size: 0.95rem;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s;
      }
      .um-add:hover:not(:disabled) {
        background: #4338ca;
      }
      .um-add:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .um-msg {
        margin: 14px 0 0;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 0.86rem;
      }
      .um-msg.err {
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #b42318;
      }

      /* accounts: a card per person on phones */
      .um-scroll {
        overflow-x: auto;
      }
      .um-table,
      .um-table tbody,
      .um-table tr,
      .um-table td {
        display: block;
      }
      .um-table thead {
        /* still read out by screen readers, just not drawn */
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .um-table tr {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px 12px;
        padding: 14px 16px;
        border-top: 1px solid #f1f4f8;
      }
      .um-table td {
        padding: 0;
        font-size: 0.92rem;
      }
      .um-table td:nth-child(1) {
        grid-column: 1 / -1;
      }
      .um-table td:nth-child(3) {
        grid-column: 1 / -1;
        order: 3;
      }
      .um-right {
        text-align: right;
      }
      .um-user {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px 12px;
        min-width: 0;
      }
      .um-avatar {
        flex: none;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #e2e8f0;
        color: #475569;
        font-size: 0.85rem;
        font-weight: 700;
      }
      .um-avatar-admin {
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: #fff;
      }
      .um-email {
        min-width: 0;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .um-you {
        padding: 2px 8px;
        border-radius: 999px;
        background: #ecfdf3;
        color: #067647;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .um-date {
        color: #64748b;
        font-size: 0.82rem !important;
        white-space: nowrap;
      }
      .um-date::before {
        content: 'Created ';
      }
      .um-dash {
        color: #cbd5e1;
      }
      .um-del {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border: 1px solid #fecdca;
        border-radius: 8px;
        background: #fff;
        color: #d92d20;
        font: inherit;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
      }
      .um-del:hover {
        border-color: #f97066;
        background: #fef3f2;
      }
      .um-empty {
        padding: 32px 16px !important;
        color: #94a3b8;
        text-align: center;
      }

      /* confirmation dialog */
      .um-confirm {
        width: min(440px, calc(100vw - 32px));
      }
      .um-confirm p {
        margin: 0;
        line-height: 1.55;
      }
      .um-note {
        margin-top: 8px !important;
        color: #64748b;
        font-size: 0.88rem;
      }
      .um-btn {
        min-width: 84px;
        padding: 10px 18px;
        border: 0;
        border-radius: 9px;
        font: inherit;
        font-size: 0.9rem;
        font-weight: 700;
        cursor: pointer;
      }
      .um-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .um-btn-ghost {
        background: #f1f5f9;
        color: #334155;
      }
      .um-btn-ghost:hover:not(:disabled) {
        background: #e2e8f0;
      }
      .um-btn-primary {
        background: #4f46e5;
        color: #fff;
      }
      .um-btn-primary:hover:not(:disabled) {
        background: #4338ca;
      }

      /* 640px and up: roomier cards, form on one row */
      @media (min-width: 640px) {
        .um-head {
          margin-bottom: 24px;
        }
        .um-head h1 {
          font-size: 1.7rem;
        }
        .um-head p {
          font-size: 0.95rem;
        }
        .um-card {
          margin-bottom: 20px;
          padding: 22px 24px;
        }
        .um-card-flush {
          padding: 0;
        }
        .um-pad {
          padding: 20px 24px 14px;
        }
        .um-new {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: end;
        }
        .um-field input,
        .um-add {
          height: 42px;
        }
        .um-field input {
          font-size: 0.93rem;
        }
      }

      /* 720px and up: the accounts become a real table */
      @media (min-width: 720px) {
        .um-table {
          display: table;
          width: 100%;
          border-collapse: collapse;
        }
        .um-table thead {
          position: static;
          display: table-header-group;
          width: auto;
          height: auto;
          overflow: visible;
          clip: auto;
        }
        .um-table tbody {
          display: table-row-group;
        }
        .um-table tr {
          display: table-row;
          padding: 0;
          border: 0;
        }
        .um-table th,
        .um-table td {
          display: table-cell;
          padding: 14px 24px;
          border-bottom: 1px solid #f1f4f8;
          vertical-align: middle;
          text-align: left;
        }
        .um-table th {
          padding-block: 10px;
          border-top: 1px solid #eef1f6;
          border-bottom: 1px solid #eef1f6;
          background: #f8fafc;
          color: #64748b;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .um-table tbody tr:last-child td {
          border-bottom: 0;
        }
        .um-table tbody tr:hover td {
          background: #fafbfe;
        }
        .um-table .um-right {
          text-align: right;
        }
        .um-user {
          flex-wrap: nowrap;
        }
        .um-email {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .um-date {
          font-size: 0.92rem !important;
        }
        .um-date::before {
          content: none;
        }
        .um-del {
          padding: 6px 12px;
        }
      }

      /* 1100px and up: the add form fits one row across the full width */
      @media (min-width: 1100px) {
        .um-new {
          grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.4fr) 190px auto;
        }
      }
    `,
  ],
})
export class Users {
  protected readonly auth = inject(AuthService);

  readonly users = signal<ManagedUser[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  /** A role change waiting for the admin's Yes or No. */
  protected readonly pending = signal<{ user: ManagedUser; role: 'user' | 'admin' } | null>(null);
  protected readonly saving = signal(false);
  email = '';
  password = '';
  role: Role = 'user';

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const { users } = await api<{ users: ManagedUser[] }>('GET', '/api/admin/users');
      this.users.set(users);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not load users.');
    }
  }

  async create(): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      await api('POST', '/api/admin/users', { email: this.email, password: this.password, role: this.role });
      this.email = this.password = '';
      this.role = 'user';
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not create user.');
    } finally {
      this.busy.set(false);
    }
  }

  protected label(role: 'user' | 'admin'): string {
    return role === 'admin' ? 'Admin' : 'User';
  }

  /** A role was picked: nothing is saved until the admin confirms with Yes. */
  protected askRole(u: ManagedUser, role: Role): void {
    if (role !== u.role) this.pending.set({ user: u, role });
  }

  protected cancelRole(): void {
    if (!this.saving()) this.pending.set(null);
  }

  /** "Yes": save the chosen role. */
  protected async confirmRole(): Promise<void> {
    const p = this.pending();
    if (!p || this.saving()) return;
    this.error.set('');
    this.saving.set(true);
    try {
      await api('PUT', `/api/admin/users/${p.user.id}/role`, { role: p.role });
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not change role.');
    } finally {
      this.saving.set(false);
      this.pending.set(null);
      await this.load();
    }
  }

  async remove(u: ManagedUser): Promise<void> {
    if (!confirm(`Delete ${u.email}? Their website files stay on disk but they lose access.`)) return;
    this.error.set('');
    try {
      await api('DELETE', `/api/admin/users/${u.id}`);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not delete user.');
    }
  }
}
