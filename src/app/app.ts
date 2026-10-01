import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toasts } from './shared/toast';

@Component({
  imports: [RouterOutlet, Toasts],
  selector: 'app-root',
  template: `<router-outlet /><app-toasts />`,
})
export class App {}
