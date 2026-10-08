import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Blocks the admin/editor routes unless a session exists; otherwise sends to /login. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.ready()) await auth.init();
  return auth.isLoggedIn() ? true : router.createUrlTree(['/login']);
};

/** Keeps a signed-in user away from the login page. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.ready()) await auth.init();
  return auth.isLoggedIn() ? router.createUrlTree(['/admin']) : true;
};

/** Admin-only routes (user management); non-admins go back to the dashboard. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.ready()) await auth.init();
  if (!auth.isLoggedIn()) return router.createUrlTree(['/login']);
  return auth.isAdmin() ? true : router.createUrlTree(['/admin']);
};
