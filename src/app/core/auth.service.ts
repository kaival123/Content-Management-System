import { Injectable, computed, signal } from '@angular/core';
import { api } from './api';

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

/** Email/password auth against the project server. The session lives in an HttpOnly cookie. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _user = signal<User | null>(null);
  private readonly _ready = signal(false);

  readonly user = this._user.asReadonly();
  /** True once the initial "who am I" check has finished, so guards don't flash the login page. */
  readonly ready = this._ready.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  readonly isAdmin = computed(() => this._user()?.role === 'admin');

  /** Loads the current session once at startup. */
  async init(): Promise<void> {
    try {
      const { user } = await api<{ user: User | null }>('GET', '/api/auth/me');
      this._user.set(user);
    } catch {
      this._user.set(null);
    } finally {
      this._ready.set(true);
    }
  }

  async login(email: string, password: string): Promise<void> {
    const { user } = await api<{ user: User }>('POST', '/api/auth/login', { email, password });
    this._user.set(user);
  }

  async register(email: string, password: string): Promise<void> {
    const { user } = await api<{ user: User }>('POST', '/api/auth/register', { email, password });
    this._user.set(user);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api('POST', '/api/account/password', { currentPassword, newPassword });
  }

  async logout(): Promise<void> {
    try {
      await api('POST', '/api/auth/logout');
    } finally {
      this._user.set(null);
    }
  }

  /** Called by the API layer on a 401 from any data call. */
  clear(): void {
    this._user.set(null);
  }
}
