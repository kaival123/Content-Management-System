import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ApiError } from '../core/api';
import { ProjectService } from '../core/project.service';

/** Shown instead of the CMS when it runs on a server (production mode) and nobody is signed in. */
@Component({
  selector: 'app-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="signin">
      <form class="signin-card" (submit)="submit($event)">
        <div class="signin-logo" aria-hidden="true">◆</div>
        <h1>Sign in to the CMS</h1>
        <p>Enter the admin password to edit your websites.</p>
        <label for="si-password">Password</label>
        <input id="si-password" type="password" autocomplete="current-password" autofocus required [disabled]="busy()" (input)="error.set('')" />
        @if (error()) {
          <p class="signin-error" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      </form>
    </main>
  `,
})
export class SignIn {
  private readonly project = inject(ProjectService);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
    if (!input.value) return;
    this.busy.set(true);
    try {
      await this.project.signIn(input.value);
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Could not sign in.');
      input.select();
    } finally {
      this.busy.set(false);
    }
  }
}
