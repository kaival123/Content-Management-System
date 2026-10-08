import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiError } from '../core/api';
import { AuthService } from '../core/auth.service';
import { ProjectService } from '../core/project.service';
import { SubmissionStore } from '../core/submission-store';
import { PhoneInput, PhoneValue } from '../shared/phone-input';

/** Sign-in / sign-up screen. On success it routes into the admin dashboard. */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhoneInput],
  template: `
    <div class="login-wrap">
      <form class="login-card" (ngSubmit)="submit()">
        <div class="login-brand"><span class="login-mark">C</span> Landing CMS</div>
        <h1>{{ mode() === 'login' ? 'Sign in' : 'Create your account' }}</h1>
        <p class="login-sub">
          {{ mode() === 'login' ? 'Sign in to build and manage your websites.' : 'Sign up to start building websites.' }}
        </p>

        @if (mode() === 'login') {
          <label>
            Email or mobile number
            <input type="text" name="identifier" [(ngModel)]="identifier" autocomplete="username" required autofocus />
          </label>
        } @else {
          <label>
            Email
            <input type="email" name="email" [(ngModel)]="email" autocomplete="email" required autofocus />
          </label>
          <div class="login-phone">
            <span class="login-field-label">Mobile number <span class="login-optional">(optional)</span></span>
            <app-phone-input (changed)="onPhone($event)" />
          </div>
        }
        <label>
          Password
          <input type="password" name="password" [(ngModel)]="password" autocomplete="{{ mode() === 'login' ? 'current-password' : 'new-password' }}" required />
        </label>

        @if (error()) {
          <p class="login-error">{{ error() }}</p>
        }

        <button type="submit" class="login-btn" [disabled]="busy()">
          {{ busy() ? 'Please wait…' : mode() === 'login' ? 'Sign in' : 'Create account' }}
        </button>

        <p class="login-switch">
          {{ mode() === 'login' ? "Don't have an account?" : 'Already have an account?' }}
          <button type="button" (click)="toggle()">{{ mode() === 'login' ? 'Sign up' : 'Sign in' }}</button>
        </p>
      </form>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: #0f172a;
        color: #0f172a;
      }
      .login-wrap {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: radial-gradient(1200px 600px at 50% -10%, #1e293b, #0f172a);
      }
      .login-card {
        width: 100%;
        max-width: 380px;
        background: #fff;
        border-radius: 16px;
        padding: 32px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .login-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        color: #0f172a;
      }
      .login-mark {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: #4f46e5;
        color: #fff;
        font-weight: 800;
      }
      h1 {
        font-size: 1.4rem;
        margin: 6px 0 0;
      }
      .login-sub {
        margin: 0 0 6px;
        color: #64748b;
        font-size: 0.9rem;
      }
      .login-optional {
        color: #94a3b8;
        font-weight: 400;
      }
      .login-phone {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .login-field-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #334155;
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
      .login-error {
        margin: 0;
        padding: 10px 12px;
        background: #fef2f2;
        color: #b91c1c;
        border-radius: 10px;
        font-size: 0.85rem;
      }
      .login-btn {
        margin-top: 4px;
        padding: 12px;
        border: none;
        border-radius: 10px;
        background: #4f46e5;
        color: #fff;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
      }
      .login-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .login-switch {
        margin: 4px 0 0;
        text-align: center;
        font-size: 0.85rem;
        color: #64748b;
      }
      .login-switch button {
        background: none;
        border: none;
        color: #4f46e5;
        font-weight: 600;
        cursor: pointer;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly project = inject(ProjectService);
  private readonly submissions = inject(SubmissionStore);
  private readonly router = inject(Router);

  readonly mode = signal<'login' | 'register'>('login');
  readonly busy = signal(false);
  readonly error = signal('');
  identifier = ''; // email or mobile, used when signing in
  email = '';
  phone = '';
  phoneValid = true;
  password = '';

  onPhone(e: PhoneValue): void {
    this.phone = e.value;
    this.phoneValid = e.valid;
  }

  toggle(): void {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.error.set('');
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.mode() === 'register' && !this.phoneValid) {
      this.error.set('Enter a valid mobile number for the selected country, or leave it empty.');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'login') await this.auth.login(this.identifier, this.password);
      else await this.auth.register(this.email, this.password, this.phone);
      // Load this user's project folder now that we have a session, then enter the app.
      await this.project.connect();
      void this.submissions.load();
      await this.router.navigateByUrl('/admin');
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
