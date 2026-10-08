import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError } from '../../core/api';
import { AuthService } from '../../core/auth.service';

/** The signed-in user's account: shows email/role and lets them change their password. */
@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="prof">
      <h1>Your profile</h1>

      <section class="prof-card">
        <h2>Account</h2>
        <div class="prof-row"><span>Email</span><strong>{{ auth.user()?.email }}</strong></div>
        <div class="prof-row">
          <span>Role</span>
          <strong class="prof-role" [class.admin]="auth.isAdmin()">{{ auth.user()?.role }}</strong>
        </div>
      </section>

      <section class="prof-card">
        <h2>Change password</h2>
        <form (ngSubmit)="changePassword()">
          <label>Current password<input type="password" name="cur" [(ngModel)]="current" autocomplete="current-password" required /></label>
          <label>New password<input type="password" name="new" [(ngModel)]="next" autocomplete="new-password" required /></label>
          <label>Confirm new password<input type="password" name="confirm" [(ngModel)]="confirm" autocomplete="new-password" required /></label>

          @if (error()) {
            <p class="prof-msg err">{{ error() }}</p>
          }
          @if (done()) {
            <p class="prof-msg ok">Password updated.</p>
          }
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Update password' }}</button>
        </form>
      </section>
    </div>
  `,
  styles: [
    `
      .prof {
        max-width: 560px;
        padding: 24px;
      }
      h1 {
        margin: 0 0 20px;
      }
      .prof-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 20px 22px;
        margin-bottom: 18px;
      }
      .prof-card h2 {
        margin: 0 0 14px;
        font-size: 1.05rem;
      }
      .prof-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #f1f5f9;
      }
      .prof-row:last-child {
        border-bottom: none;
      }
      .prof-row span {
        color: #64748b;
      }
      .prof-role {
        text-transform: capitalize;
      }
      .prof-role.admin {
        color: #4f46e5;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        color: #334155;
      }
      input {
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        font-size: 1rem;
        font-family: inherit;
      }
      input:focus {
        outline: 2px solid #4f46e5;
        border-color: #4f46e5;
      }
      .prof-msg {
        margin: 0;
        padding: 10px 12px;
        border-radius: 10px;
        font-size: 0.85rem;
      }
      .prof-msg.err {
        background: #fef2f2;
        color: #b91c1c;
      }
      .prof-msg.ok {
        background: #f0fdf4;
        color: #15803d;
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
export class Profile {
  protected readonly auth = inject(AuthService);

  current = '';
  next = '';
  confirm = '';
  readonly busy = signal(false);
  readonly error = signal('');
  readonly done = signal(false);

  async changePassword(): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    this.done.set(false);
    if (this.next !== this.confirm) {
      this.error.set('The new passwords do not match.');
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.changePassword(this.current, this.next);
      this.done.set(true);
      this.current = this.next = this.confirm = '';
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not change password.');
    } finally {
      this.busy.set(false);
    }
  }
}
