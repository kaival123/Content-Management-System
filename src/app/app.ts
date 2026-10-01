import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ProjectService } from './core/project.service';
import { SignIn } from './shared/sign-in';
import { Toasts } from './shared/toast';

@Component({
  imports: [RouterOutlet, SignIn, Toasts],
  selector: 'app-root',
  template: `
    @if (project.status() === 'signin') {
      <app-sign-in />
    } @else {
      <router-outlet />
    }
    <app-toasts />
  `,
})
export class App {
  protected readonly project = inject(ProjectService);
}
