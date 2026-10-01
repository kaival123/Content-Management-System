import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FieldDef } from '../../core/models';
import { Icon } from '../../shared/icon';
import { ProjectService, assetUrl } from '../../core/project.service';
import { readImageAsDataUrl } from '../../shared/files';
import { ToastService } from '../../shared/toast';

export interface FieldPatch {
  key: string;
  value: unknown;
  /** Dotted path used to group rapid edits into one undo step. */
  path: string;
}

let nextFormId = 0;

/**
 * Renders form controls for a list of field definitions and emits a patch
 * whenever a value changes. List fields render this component recursively.
 */
@Component({
  selector: 'app-section-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './section-form.html',
})
export class SectionForm {
  /** Unique prefix for element ids, since forms nest and fields repeat. */
  protected readonly idp = `sf${nextFormId++}-`;
  readonly fields = input.required<FieldDef[]>();
  readonly data = input.required<any>();
  /** Pages of the website, offered as link targets for URL fields (stored as "page:<slug>"). */
  readonly pages = input<{ slug: string; title: string }[]>([]);
  readonly patch = output<FieldPatch>();

  private readonly toast = inject(ToastService);
  private readonly project = inject(ProjectService);
  protected readonly assetUrl = assetUrl;
  /** Which list items are expanded, keyed by "field:index". */
  protected readonly open = signal<Set<string>>(new Set(['items:0', 'plans:0', 'links:0']));

  protected emit(key: string, value: unknown): void {
    this.patch.emit({ key, value, path: key });
  }

  protected text(key: string, e: Event): void {
    this.emit(key, (e.target as HTMLInputElement).value);
  }

  protected linkPage(key: string, e: Event): void {
    const slug = (e.target as HTMLSelectElement).value;
    if (slug) this.emit(key, `page:${slug}`);
  }

  protected num(key: string, e: Event): void {
    this.emit(key, Number((e.target as HTMLInputElement).value));
  }

  protected check(key: string, e: Event): void {
    this.emit(key, (e.target as HTMLInputElement).checked);
  }

  protected lines(key: string, e: Event): void {
    this.emit(key, (e.target as HTMLTextAreaElement).value.split('\n'));
  }

  protected joinLines(value: unknown): string {
    return Array.isArray(value) ? value.join('\n') : '';
  }

  protected async upload(key: string, e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      // Stored as a file in site/assets/images/; the field keeps its project path.
      this.emit(key, await this.project.uploadImage(file, await readImageAsDataUrl(file)));
    } catch (err) {
      this.toast.show(err instanceof Error ? err.message : 'Upload failed', 'error');
    }
  }

  // --- list fields -------------------------------------------------------

  protected items(key: string): any[] {
    return Array.isArray(this.data()[key]) ? this.data()[key] : [];
  }

  protected isOpen(key: string, i: number): boolean {
    return this.open().has(`${key}:${i}`);
  }

  protected toggle(key: string, i: number): void {
    const id = `${key}:${i}`;
    this.open.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  protected itemTitle(f: FieldDef, item: any, i: number): string {
    const first = f.itemFields?.find((x) => x.type === 'text' || x.type === 'textarea');
    const value = first ? String(item?.[first.key] ?? '').trim() : '';
    return value || `${f.itemLabel ?? 'Item'} ${i + 1}`;
  }

  protected patchItem(f: FieldDef, i: number, p: FieldPatch): void {
    const list = this.items(f.key).map((item, idx) => (idx === i ? { ...item, [p.key]: p.value } : item));
    this.patch.emit({ key: f.key, value: list, path: `${f.key}.${i}.${p.path}` });
  }

  protected addItem(f: FieldDef): void {
    const list = this.items(f.key);
    // Give every item field an empty value so the form and renderer see a complete item.
    const blank: any = {};
    for (const field of f.itemFields ?? []) {
      blank[field.key] = field.type === 'lines' ? [] : field.type === 'toggle' ? false : '';
    }
    const firstText = f.itemFields?.find((x) => x.type === 'text');
    if (firstText) blank[firstText.key] = `New ${(f.itemLabel ?? 'item').toLowerCase()}`;
    this.emit(f.key, [...list, blank]);
    this.open.update((s) => new Set(s).add(`${f.key}:${list.length}`));
  }

  protected removeItem(f: FieldDef, i: number): void {
    this.emit(f.key, this.items(f.key).filter((_, idx) => idx !== i));
  }

  protected moveItem(f: FieldDef, i: number, dir: -1 | 1): void {
    const list = [...this.items(f.key)];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.emit(f.key, list);
  }

  protected duplicateItem(f: FieldDef, i: number): void {
    const list = [...this.items(f.key)];
    list.splice(i + 1, 0, structuredClone(list[i]));
    this.emit(f.key, list);
  }
}
