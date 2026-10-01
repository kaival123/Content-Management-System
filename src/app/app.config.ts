import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { Exporter } from './core/exporter';
import { PageStore } from './core/page-store';
import { ProjectService } from './core/project.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // Connect to the project folder before the first screen renders. PageStore and
    // Exporter are created first so they receive the initial pages and later saves.
    provideAppInitializer(() => {
      inject(PageStore);
      inject(Exporter);
      return inject(ProjectService).connect();
    }),
  ],
};
