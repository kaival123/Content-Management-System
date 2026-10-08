import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { PhoneInput, PhoneValue } from '../../shared/phone-input';

/** The signed-in user's account: shows email/role and lets them change their password. */
@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhoneInput],
  template: `
    <div class="prof">
      <h1>Your profile</h1>

      <div class="prof-grid">
        <div class="prof-col">
          <section class="prof-card">
            <h2>Account</h2>
            <div class="prof-row"><span>Email</span><strong>{{ auth.user()?.email }}</strong></div>
            <div class="prof-row">
              <span>Role</span>
              <strong class="prof-role" [class.admin]="auth.isAdmin()">{{ auth.user()?.role }}</strong>
            </div>
          </section>

          <section class="prof-card">
            <h2>Mobile number</h2>
            <p class="prof-hint">Used to sign in with your number instead of your email. Leave empty to remove it.</p>
            <form (ngSubmit)="savePhone()">
              <span class="prof-field-label">Mobile number</span>
              <app-phone-input [value]="initialPhone" (changed)="onPhone($event)" />
              @if (phoneError()) {
                <p class="prof-msg err">{{ phoneError() }}</p>
              }
              @if (phoneDone()) {
                <p class="prof-msg ok">Mobile number updated.</p>
              }
              <button type="submit" class="btn btn-primary" [disabled]="phoneBusy()">{{ phoneBusy() ? 'Saving…' : 'Save number' }}</button>
            </form>
          </section>
        </div>

        <div class="prof-col">
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
    </div>
  `,
  styles: [
    `
      .prof {
        max-width: 920px;
        padding: 24px;
      }
      h1 {
        margin: 0 0 20px;
      }
      /* Two columns on desktop: Account + Mobile on the left, Change password on the right. */
      .prof-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
        align-items: start;
      }
      .prof-col {
        display: flex;
        flex-direction: column;
        gap: 18px;
        min-width: 0;
      }
      @media (max-width: 760px) {
        .prof-grid {
          grid-template-columns: 1fr;
        }
      }
      .prof-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 20px 22px;
      }
      .prof-card h2 {
        margin: 0 0 14px;
        font-size: 1.05rem;
      }
      .prof-hint {
        margin: -6px 0 14px;
        color: #64748b;
        font-size: 0.86rem;
      }
      .prof-field-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #334155;
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

  readonly initialPhone = this.auth.user()?.phone ?? '';
  private phone = this.initialPhone;
  private phoneValid = true;
  readonly phoneBusy = signal(false);
  readonly phoneError = signal('');
  readonly phoneDone = signal(false);

  onPhone(e: PhoneValue): void {
    this.phone = e.value;
    this.phoneValid = e.valid;
    this.phoneError.set('');
    this.phoneDone.set(false);
  }

  async savePhone(): Promise<void> {
    if (this.phoneBusy()) return;
    this.phoneDone.set(false);
    if (!this.phoneValid) {
      this.phoneError.set('Enter a valid mobile number for the selected country.');
      return;
    }
    this.phoneError.set('');
    this.phoneBusy.set(true);
    try {
      await this.auth.updatePhone(this.phone);
      this.phoneDone.set(true);
    } catch (e) {
      this.phoneError.set(e instanceof ApiError ? e.message : 'Could not update the mobile number.');
    } finally {
      this.phoneBusy.set(false);
    }
  }

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
