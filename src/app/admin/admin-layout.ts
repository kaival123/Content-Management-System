import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
        </nav>
        <div class="adm-sidebar-foot">
          <span class="conn" [class.conn-ok]="project.status() === 'ready'" [class.conn-bad]="project.status() === 'offline'">
            {{ project.status() === 'ready' ? 'Synced with project folder' : project.status() === 'offline' ? 'Project server offline' : 'Connecting…' }}
          </span>
          @if (project.siteDir()) {
            <button type="button" class="adm-folder" [title]="'Open ' + project.siteDir() + ' in VS Code'" (click)="openInVsCode()">
              <app-icon name="external" [size]="13" /> {{ project.siteDir() }}
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
})
export class AdminLayout {
  protected readonly pages = inject(PageStore);
  protected readonly leads = inject(LeadStore);
  protected readonly project = inject(ProjectService);
  protected readonly websites = inject(WebsiteStore);

  protected openInVsCode(): void {
    this.project.openInEditor().catch((e: Error) => alert(e.message));
  }
}
