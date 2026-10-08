import { Injectable, computed, signal } from '@angular/core';
import { api, setActingAs } from './api';

export interface User {
  id: string;
  email: string;
  phone?: string | null;
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

  /** When an admin is viewing another user's websites, who that is (else null). */
  private readonly _viewingAs = signal<{ id: string; email: string } | null>(null);
  readonly viewingAs = this._viewingAs.asReadonly();

  /** Start viewing another user's project (admin only). */
  viewAs(u: { id: string; email: string }): void {
    this._viewingAs.set(u);
    setActingAs(u.id);
  }

  /** Return to the admin's own project. */
  stopViewing(): void {
    this._viewingAs.set(null);
    setActingAs(null);
  }

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

  /** `identifier` is an email address or a mobile number. */
  async login(identifier: string, password: string): Promise<void> {
    const { user } = await api<{ user: User }>('POST', '/api/auth/login', { identifier, password });
    this._user.set(user);
  }

  async register(email: string, password: string, phone?: string): Promise<void> {
    const { user } = await api<{ user: User }>('POST', '/api/auth/register', { email, password, phone });
    this._user.set(user);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api('POST', '/api/account/password', { currentPassword, newPassword });
  }

  /** Updates the signed-in user's mobile number (empty clears it). */
  async updatePhone(phone: string): Promise<void> {
    const { user } = await api<{ user: User }>('POST', '/api/account/phone', { phone });
    this._user.set(user);
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
    this.stopViewing();
  }
}
