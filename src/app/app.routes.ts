import { inject } from '@angular/core';
import { Router, Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth.guard';
import { isReservedSlug } from './core/util';

/**
 * Public website URLs: /<website> is the homepage, /<website>/<page>/<sub-page>…
 * follows the page tree. The first segment can't be one of the app's own paths.
 */
export function publicPageMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (!segments.length || isReservedSlug(segments[0].path) || segments[0].path.includes('.')) return null;
  return {
    consumed: segments,
    posParams: { site: segments[0], path: new UrlSegment(segments.slice(1).map((s) => s.path).join('/'), {}) },
  };
}

/** Links from before clean URLs: /p/<website>/… */
export function legacyPublicMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length < 2 || segments[0].path !== 'p') return null;
  return { consumed: segments, posParams: { rest: new UrlSegment(segments.slice(1).map((s) => s.path).join('/'), {}) } };
}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'admin' },
  {
    path: 'login',
    title: 'Sign in · CMS',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/login').then((m) => m.Login),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./admin/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', title: 'Websites · CMS', loadComponent: () => import('./admin/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'new', title: 'Create website · CMS', loadComponent: () => import('./admin/new-page/new-page').then((m) => m.NewPage) },
      {
        path: 'submissions',
        title: 'Submissions · CMS',
        loadComponent: () => import('./admin/submissions/submissions').then((m) => m.Submissions),
      },
      {
        path: 'profile',
        title: 'Your profile · CMS',
        loadComponent: () => import('./admin/profile/profile').then((m) => m.Profile),
      },
      {
        path: 'users',
        title: 'User management · CMS',
        canActivate: [adminGuard],
        loadComponent: () => import('./admin/users/users').then((m) => m.Users),
      },
    ],
  },
  {
    path: 'admin/pages/:id',
    title: 'Editor · CMS',
    canActivate: [authGuard],
    loadComponent: () => import('./admin/editor/editor').then((m) => m.Editor),
  },
  {
    path: 'admin/code',
    title: 'Developer mode · CMS',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/code/dev-mode').then((m) => m.DevMode),
  },
  // /p/<website>/… → /<website>/… (keeps ?preview and #hash)
  {
    matcher: legacyPublicMatcher,
    redirectTo: ({ params, queryParams, fragment }) =>
      inject(Router).createUrlTree(['/', ...String(params['rest']).split('/').filter(Boolean)], { queryParams, fragment: fragment ?? undefined }),
  },
  { matcher: publicPageMatcher, loadComponent: () => import('./public/public-page').then((m) => m.PublicPage) },
  { path: '**', redirectTo: 'admin' },
];
