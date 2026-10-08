import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
    <div class="adm-shell">
      <aside class="adm-sidebar">
        <a class="adm-logo" routerLink="/admin">
          <span class="adm-logo-mark">C</span>
          <span>Landing CMS</span>
        </a>
        <nav class="adm-nav">
          <a routerLink="/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            <app-icon name="globe" /> Websites
            <span class="adm-count">{{ websites.websites().length }}</span>
          </a>
          <a routerLink="/admin/new" routerLinkActive="active"><app-icon name="plus" /> Create new website</a>
          <a routerLink="/admin/code"><app-icon name="code" /> Developer mode</a>
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
              <span class="adm-account-email" [title]="user.email">
                {{ user.email }}@if (user.role === 'admin') {<span class="adm-role">admin</span>}
              </span>
              <button type="button" class="adm-signout" (click)="logout()">Sign out</button>
            </div>
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
      .adm-account {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .adm-account-email {
        font-size: 0.8rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .adm-role {
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 6px;
        background: #4f46e5;
        color: #fff;
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .adm-signout {
        flex: none;
        background: none;
        border: 1px solid currentColor;
        border-radius: 8px;
        padding: 4px 10px;
        font-size: 0.78rem;
        cursor: pointer;
        opacity: 0.8;
      }
      .adm-signout:hover {
        opacity: 1;
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

  protected openInVsCode(): void {
    this.project.openInEditor().catch((e: Error) => alert(e.message));
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
