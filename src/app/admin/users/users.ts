import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, api } from '../../core/api';
import { AuthService } from '../../core/auth.service';

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
  imports: [FormsModule, DatePipe],
  template: `
    <div class="um">
      <h1>User management</h1>

      <section class="um-card">
        <h2>Add a user</h2>
        <form class="um-new" (ngSubmit)="create()">
          <input type="email" name="email" placeholder="email@example.com" [(ngModel)]="email" required />
          <input type="password" name="password" placeholder="Temporary password" [(ngModel)]="password" required />
          <select name="role" [(ngModel)]="role">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Add</button>
        </form>
        @if (error()) {
          <p class="um-msg err">{{ error() }}</p>
        }
      </section>

      <section class="um-card">
        <h2>Accounts <span class="um-count">{{ users().length }}</span></h2>
        <table class="um-table">
          <thead>
            <tr><th>Email</th><th>Role</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr>
                <td>
                  {{ u.email }}
                  @if (u.id === auth.user()?.id) {
                    <span class="um-you">you</span>
                  }
                </td>
                <td>
                  <select [ngModel]="u.role" (ngModelChange)="setRole(u, $event)" [disabled]="u.id === auth.user()?.id">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td class="um-date">{{ u.created_at | date: 'mediumDate' }}</td>
                <td>
                  @if (u.id !== auth.user()?.id) {
                    <button type="button" class="um-del" (click)="remove(u)">Delete</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    </div>
  `,
  styles: [
    `
      .um {
        max-width: 820px;
        padding: 24px;
      }
      h1 {
        margin: 0 0 20px;
      }
      .um-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 20px 22px;
        margin-bottom: 18px;
      }
      .um-card h2 {
        margin: 0 0 14px;
        font-size: 1.05rem;
      }
      .um-count {
        margin-left: 6px;
        padding: 1px 8px;
        border-radius: 999px;
        background: #eef2ff;
        color: #4f46e5;
        font-size: 0.75rem;
      }
      .um-new {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .um-new input,
      .um-new select,
      .um-table select {
        padding: 9px 11px;
        border: 1px solid #cbd5e1;
        border-radius: 9px;
        font-size: 0.95rem;
        font-family: inherit;
      }
      .um-new input {
        flex: 1;
        min-width: 180px;
      }
      .um-table {
        width: 100%;
        border-collapse: collapse;
      }
      .um-table th,
      .um-table td {
        text-align: left;
        padding: 10px 8px;
        border-bottom: 1px solid #f1f5f9;
        font-size: 0.9rem;
      }
      .um-table th {
        color: #64748b;
        font-weight: 600;
      }
      .um-date {
        color: #94a3b8;
      }
      .um-you {
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 6px;
        background: #f1f5f9;
        color: #64748b;
        font-size: 0.7rem;
      }
      .um-del {
        background: none;
        border: 1px solid #fca5a5;
        color: #dc2626;
        border-radius: 8px;
        padding: 5px 10px;
        cursor: pointer;
        font-size: 0.8rem;
      }
      .um-msg {
        margin: 10px 0 0;
        padding: 10px 12px;
        border-radius: 10px;
        font-size: 0.85rem;
      }
      .um-msg.err {
        background: #fef2f2;
        color: #b91c1c;
      }
      .btn {
        padding: 9px 18px;
        border: none;
        border-radius: 9px;
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
export class Users {
  protected readonly auth = inject(AuthService);

  readonly users = signal<ManagedUser[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  email = '';
  password = '';
  role: 'user' | 'admin' = 'user';

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

  async setRole(u: ManagedUser, role: 'user' | 'admin'): Promise<void> {
    if (role === u.role) return;
    this.error.set('');
    try {
      await api('PUT', `/api/admin/users/${u.id}/role`, { role });
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not change role.');
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
