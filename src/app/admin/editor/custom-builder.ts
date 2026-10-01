import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { BUILDER_ELEMENTS, COLUMN_LAYOUTS, applyLayout, createBuilderElement, getBuilderElementDef, layoutFractions } from '../../core/builder';
import { BuilderElement, BuilderElementType, CustomSectionData, Section, Selection } from '../../core/models';
import { uid } from '../../core/util';
import { Icon } from '../../shared/icon';
import { RangeControl, SegControl, SegOption } from './controls';

/**
 * Structure editor for a 'custom' section: column layout plus the elements in each
 * column. Emits the whole updated data object; element content and style are edited
 * in the element panel after selecting one.
 */
@Component({
  selector: 'app-custom-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RangeControl, SegControl],
  template: `
    @let d = data();
    <h3 class="panel-label">Column layout</h3>
    <div class="layouts">
      @for (l of layouts; track l.value) {
        <button type="button" class="layout-opt" [class.active]="d.layout === l.value" [title]="l.label" (click)="setLayout(l.value)">
          @for (f of fractions(l.value); track $index) {
            <span [style.flex]="f"></span>
          }
        </button>
      }
    </div>
    <app-range-control label="Space between columns" [value]="d.gap" [min]="0" [max]="120" [step]="4" [fallback]="32" (valueChange)="set('gap', $event ?? 32)" />
    <app-seg-control label="Vertical alignment" [options]="valigns" [value]="d.verticalAlign" (valueChange)="set('verticalAlign', $event)" />
    <app-seg-control label="Stack columns on" [options]="stackOptions" [value]="d.stackOn" (valueChange)="set('stackOn', $event)" />

    <h3 class="panel-label">Content</h3>
    @for (col of d.columns; track col.id; let ci = $index) {
      <div class="bcol" [class.drop-target]="dropCol() === ci" (dragover)="onDragOver(ci, null, $event)" (drop)="onDrop(ci, null, $event)">
        <div class="bcol-head">
          <strong>Column {{ ci + 1 }}</strong>
          <button type="button" class="btn-icon sm" title="Column style" [class.active-icon]="isSelected('col:' + col.id)" (click)="selectionChange.emit({ sectionId: section().id, el: 'col:' + col.id, index: null })">
            <app-icon name="palette" [size]="14" />
          </button>
        </div>
        @for (e of col.elements; track e.id; let ei = $index, first = $first, last = $last) {
          <div
            class="bel"
            [class.selected]="isSelected('el:' + e.id)"
            [class.drop-before]="dropCol() === ci && dropIndex() === ei"
            draggable="true"
            (dragstart)="onDragStart(ci, ei, $event)"
            (dragend)="onDragEnd()"
            (dragover)="onDragOver(ci, ei, $event)"
            (drop)="onDrop(ci, ei, $event)"
            (click)="selectionChange.emit({ sectionId: section().id, el: 'el:' + e.id, index: null })"
          >
            <span class="sec-grip"><app-icon name="grip" [size]="13" /></span>
            <span class="bel-icon"><app-icon [name]="def(e.type).icon" [size]="15" /></span>
            <span class="bel-name">
              {{ def(e.type).label }}
              <small>{{ summary(e) }}</small>
            </span>
            <span class="sec-actions">
              <button type="button" class="btn-icon sm" title="Move up" [disabled]="first" (click)="move(ci, ei, -1, $event)"><app-icon name="up" [size]="13" /></button>
              <button type="button" class="btn-icon sm" title="Move down" [disabled]="last" (click)="move(ci, ei, 1, $event)"><app-icon name="down" [size]="13" /></button>
              <button type="button" class="btn-icon sm" title="Duplicate" (click)="duplicate(ci, ei, $event)"><app-icon name="copy" [size]="13" /></button>
              <button type="button" class="btn-icon sm danger" title="Delete" (click)="remove(ci, ei, $event)"><app-icon name="trash" [size]="13" /></button>
            </span>
          </div>
        } @empty {
          <p class="bcol-empty">Drop or add elements here</p>
        }
        @if (addingTo() === ci) {
          <div class="el-picker">
            @for (b of elementDefs; track b.type) {
              <button type="button" (click)="add(ci, b.type)">
                <app-icon [name]="b.icon" [size]="18" />
                {{ b.label }}
              </button>
            }
          </div>
        }
        <button type="button" class="btn btn-sm btn-dashed btn-block" (click)="addingTo.set(addingTo() === ci ? null : ci)">
          <app-icon [name]="addingTo() === ci ? 'x' : 'plus'" [size]="14" /> {{ addingTo() === ci ? 'Close' : 'Add element' }}
        </button>
      </div>
    }
  `,
})
export class CustomBuilder {
  readonly section = input.required<Section>();
  readonly selection = input<Selection | null>(null);
  readonly dataChange = output<CustomSectionData>();
  readonly selectionChange = output<Selection>();
  /** Emitted with the new element's selection right after it is added. */
  readonly elementAdded = output<Selection>();

  protected readonly data = computed(() => this.section().data as CustomSectionData);
  protected readonly addingTo = signal<number | null>(null);
  protected readonly dropCol = signal<number | null>(null);
  protected readonly dropIndex = signal<number | null>(null);
  private drag: { col: number; index: number } | null = null;

  protected readonly layouts = COLUMN_LAYOUTS;
  protected readonly elementDefs = BUILDER_ELEMENTS;
  protected readonly valigns: SegOption<'start' | 'center' | 'end'>[] = [
    { value: 'start', label: 'Top' },
    { value: 'center', label: 'Middle' },
    { value: 'end', label: 'Bottom' },
  ];
  protected readonly stackOptions: SegOption<'tablet' | 'mobile' | 'never'>[] = [
    { value: 'tablet', label: 'Tablet', icon: 'tablet' },
    { value: 'mobile', label: 'Phone', icon: 'phone' },
    { value: 'never', label: 'Never' },
  ];

  protected fractions(layout: string): number[] {
    return layoutFractions(layout);
  }

  protected def(type: BuilderElementType) {
    return getBuilderElementDef(type);
  }

  protected isSelected(key: string): boolean {
    const sel = this.selection();
    return !!sel && sel.sectionId === this.section().id && sel.el === key;
  }

  protected summary(e: BuilderElement): string {
    const d = e.data;
    const text = d.text ?? d.label ?? d.caption ?? d.alt ?? d.icon ?? d.url ?? (Array.isArray(d.items) ? d.items.join(', ') : '');
    if (e.type === 'spacer') return `${d.height ?? 40}px`;
    if (e.type === 'html') return 'HTML';
    return String(text ?? '').slice(0, 40);
  }

  /** Applies `recipe` to a deep copy of the data and emits it. */
  private update(recipe: (d: CustomSectionData) => void): void {
    const next = structuredClone(this.data());
    recipe(next);
    this.dataChange.emit(next);
  }

  protected set<K extends keyof CustomSectionData>(key: K, value: CustomSectionData[K] | undefined): void {
    if (value === undefined) return;
    this.update((d) => (d[key] = value));
  }

  protected setLayout(layout: string): void {
    this.update((d) => {
      d.layout = layout;
      d.columns = applyLayout(d.columns, layout);
    });
  }

  protected add(col: number, type: BuilderElementType): void {
    const el = createBuilderElement(type);
    this.update((d) => d.columns[col].elements.push(el));
    this.addingTo.set(null);
    this.elementAdded.emit({ sectionId: this.section().id, el: 'el:' + el.id, index: null });
  }

  protected move(col: number, index: number, dir: -1 | 1, e: Event): void {
    e.stopPropagation();
    this.update((d) => {
      const list = d.columns[col].elements;
      const j = index + dir;
      if (j < 0 || j >= list.length) return;
      [list[index], list[j]] = [list[j], list[index]];
    });
  }

  protected duplicate(col: number, index: number, e: Event): void {
    e.stopPropagation();
    this.update((d) => {
      const list = d.columns[col].elements;
      list.splice(index + 1, 0, { ...structuredClone(list[index]), id: uid('e_') });
    });
  }

  protected remove(col: number, index: number, e: Event): void {
    e.stopPropagation();
    this.update((d) => d.columns[col].elements.splice(index, 1));
  }

  // Drag and drop, within and across columns.
  protected onDragStart(col: number, index: number, e: DragEvent): void {
    this.drag = { col, index };
    e.dataTransfer?.setData('text/plain', 'element');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(col: number, index: number | null, e: DragEvent): void {
    if (!this.drag) return;
    e.preventDefault();
    e.stopPropagation();
    this.dropCol.set(col);
    this.dropIndex.set(index);
  }

  protected onDrop(col: number, index: number | null, e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const from = this.drag;
    this.onDragEnd();
    if (!from) return;
    this.update((d) => {
      const [el] = d.columns[from.col].elements.splice(from.index, 1);
      const target = d.columns[col].elements;
      let at = index ?? target.length;
      // Removing from earlier in the same column shifts the target position.
      if (from.col === col && index !== null && from.index < index) at--;
      target.splice(at, 0, el);
    });
  }

  protected onDragEnd(): void {
    this.drag = null;
    this.dropCol.set(null);
    this.dropIndex.set(null);
  }
}
