import { Component, EventEmitter, Input, Output, HostListener, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Note } from '../../models/review.model';
import { WaitlistBoardComponent } from '../waitlist-board/waitlist-board.component';

@Component({
  selector: 'app-notes-board',
  standalone: true,
  imports: [CommonModule, FormsModule, WaitlistBoardComponent],
  templateUrl: './notes-board.component.html',
  styleUrls: ['./notes-board.component.scss'],
})
export class NotesBoardComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() notes: Note[] = [];
  @Input() adding = false;
  @Input() deleting = false;
  @Input() editing = false;
  @Input() editError: string | null = null;
  @Input() addError: string | null = null;
  // Hay notas sin leer en este dispositivo: el modal se abre directamente en "Notas".
  @Input() hasUnread = false;

  // Se emite cuando se muestra la pestaña de notas (las da por leídas).
  @Output() notesViewed = new EventEmitter<void>();
  @Output() closeRequested = new EventEmitter<void>();
  @Output() addNote = new EventEmitter<{ text: string; clientId: string }>();
  @Output() deleteNote = new EventEmitter<string>();
  @Output() editNote = new EventEmitter<{ id: string; text: string }>();
  @Output() editSessionEnded = new EventEmitter<void>();

  // Mientras el modal está abierto, la página de detrás queda bloqueada: no se
  // cierra al pulsar fuera (solo con la ✕ o Escape, para no perder lo que se
  // esté escribiendo) y tampoco se puede hacer scroll de lo que hay detrás.
  nudge = false; // pequeña sacudida del modal al pulsar fuera, para que se vea que no es un fallo
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private lockedBody: { overflow: string; paddingRight: string } | null = null;

  tab: 'espera' | 'notas' = 'espera';
  waitFormOpen = false; // la lista de espera tiene un formulario abierto (Escape lo cierra a él, no al modal)

  draft = '';
  editingId: string | null = null;
  editDraft = '';
  editRows = 4;
  private savingEdit = false; // esperando la confirmación del backend, no solo el clic
  private savingAdd = false;
  private addRequestId: string | null = null;

  selectTab(t: 'espera' | 'notas'): void {
    this.tab = t;
    this.waitFormOpen = false;
    if (t === 'notas') this.notesViewed.emit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) this.setPageLocked(this.open);

    // Al abrir el modal: en la lista de espera, salvo que haya notas sin leer.
    if (changes['open'] && this.open) {
      this.tab = this.hasUnread ? 'notas' : 'espera';
      this.waitFormOpen = false;
      // En un microtask: emitir durante la detección de cambios modificaría el padre ya comprobado.
      if (this.tab === 'notas') Promise.resolve().then(() => this.notesViewed.emit());
    }

    // 'editing'/'adding' pasan a false cuando el backend responde. Solo
    // entonces sabemos si el guardado fue bien o mal: si fue bien, cerramos
    // el modo edición o vaciamos el composer; si falló, dejamos el texto
    // tal cual para reintentar en vez de revertir/perder en silencio.
    if (changes['editing'] && !this.editing && this.savingEdit) {
      this.savingEdit = false;
      if (!this.editError) {
        this.editingId = null;
        this.editDraft = '';
      }
    }
    if (changes['adding'] && !this.adding && this.savingAdd) {
      this.savingAdd = false;
      if (!this.addError) {
        this.draft = '';
        this.addRequestId = null;
      }
      // Si hubo error, mantenemos draft + addRequestId: "Reintentar" reenvía
      // el MISMO clientId, así que un reintento nunca duplica la nota
      // aunque el intento anterior sí hubiera llegado a guardarse.
    }
  }

  private setPageLocked(lock: boolean): void {
    const body = document.body;
    if (lock && !this.lockedBody) {
      this.lockedBody = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      // Al ocultar la barra de scroll de la página la pantalla "salta" a lo ancho: se compensa.
      const bar = window.innerWidth - document.documentElement.clientWidth;
      if (bar > 0) body.style.paddingRight = `${bar}px`;
      body.style.overflow = 'hidden';
    } else if (!lock && this.lockedBody) {
      body.style.overflow = this.lockedBody.overflow;
      body.style.paddingRight = this.lockedBody.paddingRight;
      this.lockedBody = null;
    }
  }

  ngOnDestroy(): void {
    this.setPageLocked(false);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
  }

  // Pulsar en la zona oscura: no cierra, solo avisa con una sacudida breve.
  onBackdropClick(): void {
    this.nudge = false;
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    // En el siguiente ciclo para poder repetir la animación en pulsaciones seguidas.
    setTimeout(() => {
      this.nudge = true;
      this.nudgeTimer = setTimeout(() => (this.nudge = false), 380);
    }, 0);
  }

  // Rueda y dedo sobre la zona oscura no deben mover nada (ni en iOS, que ignora overflow:hidden del body).
  blockOutsideScroll(ev: Event): void {
    if (ev.target === ev.currentTarget) ev.preventDefault();
  }

  private genRequestId(): string {
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.open) return;
    if (this.tab === 'espera' && this.waitFormOpen) return;
    if (this.editingId) {
      this.cancelEdit();
      return;
    }
    this.closeRequested.emit();
  }

  close(): void {
    this.closeRequested.emit();
  }

  submit(): void {
    if (this.adding) return; // ya hay un guardado en curso
    const text = this.draft.trim();
    if (!text) return;
    if (!this.addRequestId) this.addRequestId = this.genRequestId();
    this.savingAdd = true;
    this.addNote.emit({ text, clientId: this.addRequestId });
    // No vaciamos el composer aquí: esperamos a que 'adding' vuelva a false
    // (ver ngOnChanges) para saber si hay que mantener el texto o no.
  }

  remove(id: string): void {
    if (this.deleting) return;
    this.deleteNote.emit(id);
  }

  startEdit(n: Note): void {
    if (this.editing) return;
    this.editSessionEnded.emit(); // limpia el error de una edición anterior, si lo había
    this.editingId = n.id;
    this.editDraft = n.text;
    // Arranca con el mismo alto aproximado que tenía la nota en modo
    // lectura (líneas reales + ajuste por longitud), para no obligar a
    // hacer scroll dentro de un textarea diminuto al editar notas largas.
    const lines = n.text.split('\n').length;
    const wrapped = Math.ceil(n.text.length / 55);
    this.editRows = Math.min(20, Math.max(4, lines, wrapped));
  }

  cancelEdit(): void {
    this.editingId = null;
    this.editDraft = '';
    this.editSessionEnded.emit();
  }

  saveEdit(): void {
    if (this.editing || !this.editingId) return;
    const text = this.editDraft.trim();
    if (!text) return;
    this.savingEdit = true;
    this.editNote.emit({ id: this.editingId, text });
    // No cerramos el modo edición aquí: esperamos a que 'editing' vuelva a
    // false (ver ngOnChanges) para saber si hubo que mantener el texto.
  }

  fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }
}
