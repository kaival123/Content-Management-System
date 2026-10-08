import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { LeadStore } from '../core/lead-store';
import { PageStore } from '../core/page-store';
import { ProjectService } from '../core/project.service';
import { WebsiteStore } from '../core/website-store';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    <div class="adm-shell" [class.menu-open]="menuOpen()">
      <header class="adm-topbar">
        <a class="adm-logo" routerLink="/admin" (click)="menuOpen.set(false)">
          <span class="adm-logo-mark">C</span>
          <span>Landing CMS</span>
        </a>
        <button type="button" class="adm-burger" (click)="menuOpen.update((v) => !v)" [attr.aria-expanded]="menuOpen()" aria-label="Toggle menu">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            @if (menuOpen()) {
              <path d="M18 6 6 18M6 6l12 12" />
            } @else {
              <path d="M3 6h18M3 12h18M3 18h18" />
            }
          </svg>
        </button>
      </header>
      <div class="adm-backdrop" (click)="menuOpen.set(false)"></div>
      <aside class="adm-sidebar">
        <a class="adm-logo adm-logo-aside" routerLink="/admin" (click)="menuOpen.set(false)">
          <span class="adm-logo-mark">C</span>
          <span>Landing CMS</span>
        </a>
        <nav class="adm-nav" (click)="menuOpen.set(false)">
          <a routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            <app-icon name="globe" /> Websites
            <span class="adm-count">{{ websites.websites().length }}</span>
          </a>
          <a routerLink="/admin/new" routerLinkActive="active"><app-icon name="plus" /> Create new website</a>
          @if (auth.isAdmin()) {
            <a routerLink="/admin/code"><app-icon name="code" /> Developer mode</a>
          }
          <a routerLink="/admin/submissions" routerLinkActive="active">
            <app-icon name="mail" /> Submissions
            @if (leads.leads().length) {
              <span class="adm-count">{{ leads.leads().length }}</span>
            }
          </a>
          <a routerLink="/admin/profile" routerLinkActive="active"><app-icon name="external" /> Your profile</a>
          @if (auth.isAdmin()) {
            <a routerLink="/admin/users" routerLinkActive="active"><app-icon name="globe" /> User management</a>
          }
        </nav>
        <div class="adm-sidebar-foot">
          @if (auth.user(); as user) {
            <div class="adm-account">
              <span class="adm-avatar" aria-hidden="true">{{ user.email.charAt(0).toUpperCase() }}</span>
              <span class="adm-account-info">
                <span class="adm-account-email" [title]="user.email">{{ user.email }}</span>
                <span class="adm-role" [class.adm-role-admin]="user.role === 'admin'">{{ user.role === 'admin' ? 'Admin' : 'User' }}</span>
              </span>
            </div>
            <button type="button" class="adm-signout" (click)="logout()">Sign out</button>
          }
          <span class="conn" [class.conn-ok]="project.status() === 'ready'" [class.conn-bad]="project.status() === 'offline'">
            {{ project.status() === 'ready' ? 'Synced with project folder' : project.status() === 'offline' ? 'Project server offline' : 'Connecting…' }}
          </span>
          @if (project.siteDir()) {
            <button type="button" class="adm-folder" [title]="'Open ' + project.siteDir() + ' in VS Code'" (click)="openInVsCode()">
              <app-icon name="external" [size]="13" /> <span>Open in VS Code</span>
            </button>
          }
        </div>
      </aside>
      <main class="adm-main">
        @if (auth.viewingAs(); as viewing) {
          <div class="adm-viewing">
            <span><app-icon name="globe" [size]="14" /> Viewing <strong>{{ viewing.email }}</strong>'s websites</span>
            <button type="button" (click)="exitViewing()">Exit</button>
          </div>
        }
        @if (project.status() === 'offline' && !pages.loaded()) {
          <div class="adm-empty offline">
            <h2>Can't reach the project server</h2>
            <p>The CMS reads and writes your landing pages as files in the <code>site/</code> folder through a small local server (port 4310).</p>
            @if (project.error(); as err) {
              <p class="offline-reason">{{ err }}</p>
            }
            <div class="offline-steps">
              <div>
                <strong>Start everything</strong> (CMS + project server):
                <pre>npm start -- --host 0.0.0.0 --port 4200</pre>
              </div>
              <div>
                <strong>Or, if you run <code>ng serve</code> yourself</strong>, start the project server in a second terminal
                (and restart <code>ng serve</code> once so it picks up the <code>/api</code> proxy):
                <pre>npm run start:server</pre>
              </div>
            </div>
            <button type="button" class="btn btn-primary" (click)="project.connect()">Try again</button>
          </div>
        } @else {
          @if (pages.storageError(); as err) {
            <div class="adm-alert">{{ err }}</div>
          }
          @for (e of project.pageErrors(); track e.slug) {
            <div class="adm-alert">Page “{{ e.slug }}” could not be loaded: {{ e.message }} — fix it in Developer mode or VS Code.</div>
          }
          @for (c of project.componentErrors(); track c.folder) {
            <div class="adm-alert">Component {{ c.folder }}: {{ c.error }}</div>
          }
          <router-outlet />
        }
      </main>
    </div>
  `,
  styles: [
    `
      .adm-viewing {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 20px;
        padding: 10px 16px;
        border: 1px solid #fde68a;
        border-radius: 10px;
        background: #fffbeb;
        color: #92400e;
        font-size: 0.9rem;
      }
      .adm-viewing span {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .adm-viewing button {
        padding: 5px 14px;
        border: 1px solid #f59e0b;
        border-radius: 8px;
        background: #fff;
        color: #92400e;
        font-weight: 600;
        cursor: pointer;
      }
      .adm-account {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        margin-bottom: 10px;
      }
      .adm-avatar {
        flex: none;
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: #fff;
        font-size: 0.9rem;
        font-weight: 700;
      }
      .adm-account-info {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
        min-width: 0;
      }
      .adm-account-email {
        max-width: 100%;
        overflow: hidden;
        color: #e2e8f0;
        font-size: 0.82rem;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .adm-role {
        padding: 1px 8px;
        border-radius: 999px;
        background: rgb(148 163 184 / 18%);
        color: #cbd5e1;
        font-size: 0.66rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .adm-role-admin {
        background: rgb(99 102 241 / 28%);
        color: #c7d2fe;
      }
      .adm-signout {
        display: block;
        width: 100%;
        margin-bottom: 12px;
        padding: 7px 10px;
        border: 1px solid rgb(148 163 184 / 35%);
        border-radius: 8px;
        background: transparent;
        color: #cbd5e1;
        font: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .adm-signout:hover {
        border-color: rgb(248 113 113 / 60%);
        background: rgb(248 113 113 / 12%);
        color: #fecaca;
      }
      .adm-signout:focus-visible {
        outline: 2px solid #818cf8;
        outline-offset: 2px;
      }
    `,
  ],
})
export class AdminLayout {
  protected readonly pages = inject(PageStore);
  protected readonly leads = inject(LeadStore);
  protected readonly project = inject(ProjectService);
  protected readonly websites = inject(WebsiteStore);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Mobile nav drawer open/closed. */
  protected readonly menuOpen = signal(false);

  protected openInVsCode(): void {
    this.project.openInEditor().catch((e: Error) => alert(e.message));
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  /** Stop viewing another user's websites and reload the admin's own project. */
  protected async exitViewing(): Promise<void> {
    this.auth.stopViewing();
    await this.project.connect();
  }
}
