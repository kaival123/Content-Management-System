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

      <div class="prof-grid">
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
    </div>
  `,
  styles: [
    `

      /* Mobile first: the base rules are the phone layout; wider screens add to them. */
      .prof {
        width: 100%;
      }
      .prof h1 {
        margin: 0 0 16px;
        font-size: 1.4rem;
        letter-spacing: -0.02em;
      }
      .prof-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        align-items: start;
      }
      .prof-card {
        padding: 16px;
        border: 1px solid #e5e9f0;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
      }
      .prof-card h2 {
        margin: 0 0 14px;
        font-size: 1rem;
        font-weight: 700;
      }
      .prof-row {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 2px 16px;
        padding: 10px 0;
        border-bottom: 1px solid #f1f5f9;
      }
      .prof-row:last-child {
        border-bottom: none;
      }
      .prof-row span {
        color: #64748b;
        font-size: 0.88rem;
      }
      .prof-row strong {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .prof-role {
        text-transform: capitalize;
      }
      .prof-role.admin {
        color: #4f46e5;
      }
      form {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: #334155;
        font-size: 0.85rem;
        font-weight: 600;
      }
      input {
        width: 100%;
        height: 44px;
        padding: 0 12px;
        border: 1px solid #d5dbe5;
        border-radius: 10px;
        color: #0f172a;
        font: inherit;
        font-size: 1rem; /* 16px keeps iOS from zooming into the field */
        font-weight: 400;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      input:focus {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 3px rgb(99 102 241 / 18%);
      }
      .prof-msg {
        margin: 0;
        padding: 10px 12px;
        border-radius: 10px;
        font-size: 0.86rem;
      }
      .prof-msg.err {
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #b42318;
      }
      .prof-msg.ok {
        border: 1px solid #abefc6;
        background: #ecfdf3;
        color: #067647;
      }
      .btn {
        height: 44px;
        padding: 0 20px;
        border: none;
        border-radius: 10px;
        font: inherit;
        font-size: 0.95rem;
        font-weight: 700;
        cursor: pointer;
      }
      .btn-primary {
        background: #4f46e5;
        color: #fff;
      }
      .btn-primary:hover:not(:disabled) {
        background: #4338ca;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: default;
      }

      @media (min-width: 640px) {
        .prof h1 {
          margin-bottom: 24px;
          font-size: 1.7rem;
        }
        .prof-grid {
          gap: 20px;
        }
        .prof-card {
          padding: 22px 24px;
        }
        .btn {
          justify-self: start;
        }
        input {
          height: 42px;
          font-size: 0.95rem;
        }
      }

      /* 960px and up: account details beside the password form, using the full width */
      @media (min-width: 1281px) {
        .prof-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
        }
      }

      /* 1400px and up: the three password fields sit on one row */
      @media (min-width: 1450px) {
        .prof-grid {
          grid-template-columns: minmax(0, 2fr) minmax(0, 2fr);
        }
        form {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: start;
        }
        form .prof-msg,
        form .btn {
          grid-column: 1 / -1;
        }
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
