import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { Router, provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { setUnauthorizedHandler } from './core/api';
import { AuthService } from './core/auth.service';
import { Exporter } from './core/exporter';
import { PageStore } from './core/page-store';
import { ProjectService } from './core/project.service';
import { SubmissionStore } from './core/submission-store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // Check the session first. PageStore and Exporter are created so they receive pages and
    // later saves; the project folder is only loaded once we know the user is signed in.
    provideAppInitializer(async () => {
      inject(PageStore);
      inject(Exporter);
      const auth = inject(AuthService);
      const router = inject(Router);
      const project = inject(ProjectService);
      const submissions = inject(SubmissionStore);
      // A 401 from any later call means the session ended: drop it and go to login.
      setUnauthorizedHandler(() => {
        auth.clear();
        void router.navigateByUrl('/login');
      });
      await auth.init();
      if (auth.isLoggedIn()) {
        await project.connect();
        void submissions.load();
      }
    }),
  ],
};
