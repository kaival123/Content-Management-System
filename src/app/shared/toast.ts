import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly messages = signal<ToastMessage[]>([]);

  show(text: string, kind: ToastMessage['kind'] = 'success'): void {
    const id = this.nextId++;
    this.messages.update((m) => [...m, { id, text, kind }]);
    setTimeout(() => this.dismiss(id), 3200);
  }

  dismiss(id: number): void {
    this.messages.update((m) => m.filter((t) => t.id !== id));
  }
}

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" role="status" aria-live="polite">
      @for (t of toast.messages(); track t.id) {
        <button type="button" class="toast toast-{{ t.kind }}" (click)="toast.dismiss(t.id)">{{ t.text }}</button>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toast = inject(ToastService);
}
