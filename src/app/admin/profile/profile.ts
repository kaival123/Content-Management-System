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

      /* Mobile first: the base rules are the 320px phone layout; wider screens add to them. */
      .prof {
        width: 100%;
        min-width: 0;
      }
      .prof h1 {
        margin: 0 0 14px;
        font-size: 1.35rem;
        letter-spacing: -0.02em;
      }
      .prof-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
        align-items: start;
      }
      .prof-col {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
      }
      .prof-card {
        min-width: 0;
        padding: 16px;
        border: 1px solid #e5e9f0;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
      }
      .prof-card h2 {
        margin: 0 0 12px;
        font-size: 1rem;
        font-weight: 700;
      }
      .prof-hint {
        margin: -4px 0 12px;
        color: #64748b;
        font-size: 0.85rem;
        line-height: 1.45;
      }
      .prof-field-label {
        color: #334155;
        font-size: 0.85rem;
        font-weight: 600;
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
        display: flex;
        flex-direction: column;
        gap: 12px;
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
        min-width: 0;
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
        font-size: 0.85rem;
        overflow-wrap: anywhere;
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
        width: 100%;
        height: 44px;
        padding: 0 18px;
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

      /* 480px and up: buttons size to their text */
      @media (min-width: 480px) {
        .btn {
          width: auto;
          align-self: flex-start;
        }
      }

      /* 640px and up: roomier */
      @media (min-width: 640px) {
        .prof h1 {
          margin-bottom: 22px;
          font-size: 1.7rem;
        }
        .prof-grid,
        .prof-col {
          gap: 20px;
        }
        .prof-card {
          padding: 22px 24px;
        }
        input {
          height: 42px;
          font-size: 0.95rem;
        }
      }

      /* 760px and up: two columns across the full width. Account and Mobile number stack in the left
         column, Change password sits in the right one. */
      @media (min-width: 760px) {
        .prof-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
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
