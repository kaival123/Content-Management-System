import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, input, output, signal, viewChildren } from '@angular/core';
import { MergeView } from '@codemirror/merge';
import { ConflictChoice, ConflictFile } from '../../core/page-store';
import { createMergeView } from '../../shared/code-editor';
import { Icon } from '../../shared/icon';

/**
 * Review of files that changed on disk while the visual editor had unsaved edits.
 * For each file: the version on disk (left) and the editor's version (right, editable
 * for hand-merging). Nothing is written until the user applies their choices.
 */
@Component({
  selector: 'app-conflict-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="modal-backdrop" (click)="cancel.emit()"></div>
    <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="cd-title">
      <header class="modal-head">
        <div>
          <h2 id="cd-title">Review changes</h2>
          <p>These files were changed outside the visual editor (for example in VS Code) while you had unsaved edits. Choose which version to keep for each file.</p>
        </div>
        <button type="button" class="btn-icon" title="Close" (click)="cancel.emit()"><app-icon name="x" /></button>
      </header>
      <div class="modal-body">
        @for (f of files(); track f.path; let i = $index) {
          <section class="cf">
            <div class="cf-head">
              <code>{{ f.path }}</code>
              <div class="seg">
                <button type="button" [class.active]="choice(f.path) === 'theirs'" (click)="choose(f.path, 'theirs')">Keep code version</button>
                <button type="button" [class.active]="choice(f.path) === 'mine'" (click)="choose(f.path, 'mine')">Keep editor version</button>
                <button type="button" [class.active]="choice(f.path) === 'edited'" (click)="choose(f.path, 'edited')">Use merged (right side)</button>
              </div>
            </div>
            <div class="cf-labels">
              <span>On disk / code {{ f.disk === null ? '(deleted)' : '' }}</span>
              <span>Visual editor {{ f.mine === null ? '(removed)' : '' }} — editable</span>
            </div>
            <div class="cf-merge" #merge [attr.data-i]="i"></div>
          </section>
        }
      </div>
      <footer class="modal-foot">
        <span class="field-hint">{{ summary() }}</span>
        <button type="button" class="btn btn-secondary" (click)="cancel.emit()">Cancel</button>
        <button type="button" class="btn btn-primary" (click)="apply()"><app-icon name="check" [size]="16" /> Apply choices</button>
      </footer>
    </div>
  `,
})
export class ConflictDialog {
  readonly files = input.required<ConflictFile[]>();
  readonly resolve = output<Record<string, ConflictChoice>>();
  readonly cancel = output<void>();

  private readonly mergeEls = viewChildren<ElementRef<HTMLElement>>('merge');
  private readonly views: MergeView[] = [];
  private readonly choices = signal<Record<string, 'mine' | 'theirs' | 'edited'>>({});

  protected readonly summary = computed(() => {
    const c = this.choices();
    const theirs = this.files().filter((f) => (c[f.path] ?? 'mine') === 'theirs').length;
    return `${theirs} from code, ${this.files().length - theirs} from the editor`;
  });

  constructor() {
    afterNextRender(() => {
      this.mergeEls().forEach((ref, i) => {
        const f = this.files()[i];
        const view = createMergeView(ref.nativeElement, { path: f.path, a: f.disk ?? '', b: f.mine ?? '', editableB: true });
        this.views.push(view);
        // Editing the right side means the user is hand-merging.
        ref.nativeElement.addEventListener('input', () => this.choose(f.path, 'edited'));
      });
    });
  }

  protected choice(path: string): 'mine' | 'theirs' | 'edited' {
    return this.choices()[path] ?? 'mine';
  }

  protected choose(path: string, value: 'mine' | 'theirs' | 'edited'): void {
    this.choices.update((c) => ({ ...c, [path]: value }));
  }

  protected apply(): void {
    const out: Record<string, ConflictChoice> = {};
    this.files().forEach((f, i) => {
      const c = this.choice(f.path);
      out[f.path] = c === 'edited' ? { content: this.views[i].b.state.doc.toString() } : c;
    });
    this.resolve.emit(out);
  }

  ngOnDestroy(): void {
    for (const v of this.views) v.destroy();
  }
}
