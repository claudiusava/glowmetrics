import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { GlowmetricsService } from '../../services/glowmetrics.service';
import { FollowupAlertService } from '../../services/followup-alert.service';
import { FollowupItem } from '../../models/review.model';
import { addMonths, dueNow, fmtDay, followupState, FollowupState, Preset, PRESETS, presetDate, sortFollowups } from './followup-logic';
import { todayIso } from '../cleaning-board/cleaning-logic';

// Mientras la pantalla está abierta se refresca sola (la usan varias personas). Tras escribir se espera
// un poco antes de volver a leer, para que una lectura "vieja" no pise el cambio recién hecho.
const POLL_MS = 30_000;
const QUIET_AFTER_WRITE_MS = 5_000;
const TEMP_PREFIX = 'tmp_'; // repaso recién añadido cuyo guardado aún no ha vuelto
const DEFAULT_MONTHS = 12;

interface Row { item: FollowupItem; state: FollowupState; whenText: string; }

/**
 * Contactos pendientes: clientes que terminaron el tratamiento y necesitan un repaso, y leads o clientes
 * que piden que se les contacte más adelante (vacaciones, sin disponibilidad…). Se apunta el nombre y el
 * día que toca, y la app avisa ese día (número en la pestaña y en el título del navegador). Sin teléfono:
 * la API es pública; el teléfono se busca en flowww al contactar.
 */
@Component({
  selector: 'app-followup-board',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './followup-board.component.html',
  styleUrls: ['./followup-board.component.scss'],
})
export class FollowupBoardComponent implements OnInit, OnDestroy {
  items: FollowupItem[] = [];
  rows: Row[] = [];
  dueCount = 0;
  loading = true;
  loadFailed = false;
  today = todayIso();

  // Formulario (alta y edición)
  formOpen = false;
  editingId: string | null = null;
  form = { name: '', due: '', note: '' };
  formError: string | null = null;
  private addRequestId: string | null = null;

  // "Ya avisada": panel para elegir la fecha del siguiente repaso (o quitarla de la lista)
  doneOpenId: string | null = null;
  customDue = '';
  confirmDeleteId: string | null = null;

  busy = new Set<string>();
  justAddedId: string | null = null;
  toast: string | null = null;

  private seq = 0;
  private pendingWrites = 0;
  private lastWriteAt = 0;
  private destroyed = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Subscription();

  constructor(private svc: GlowmetricsService, private alert: FollowupAlertService) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.formOpen) this.closeForm();
  }

  ngOnInit(): void {
    this.alert.setViewing(true);
    this.load();
    this.subs.add(interval(POLL_MS).subscribe(() => {
      this.today = todayIso(); // pasa la medianoche con la pantalla abierta
      this.recompute();
      if (document.hidden || this.pendingWrites > 0) return;
      if (Date.now() - this.lastWriteAt < QUIET_AFTER_WRITE_MS) return;
      this.load();
    }));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.alert.setViewing(false);
    this.subs.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  // ---------- lectura ----------

  private load(): void {
    const seq = ++this.seq;
    this.subs.add(this.svc.getFollowups().subscribe(res => {
      if (this.destroyed) return;
      if (!res || !Array.isArray(res)) {
        // Sin respuesta: si aún no hay nada que enseñar, reintentamos pronto.
        if (this.loading) {
          this.loadFailed = true;
          this.retryTimer = setTimeout(() => { if (!this.destroyed) this.load(); }, 5000);
        }
        return;
      }
      if (seq !== this.seq) return; // superada por una escritura o lectura más reciente
      this.loading = false;
      this.loadFailed = false;
      this.items = res;
      this.recompute();
    }));
  }

  private recompute(): void {
    this.today = todayIso();
    this.rows = sortFollowups(this.items).map(item => {
      const state = followupState(item, this.today);
      return { item, state, whenText: state.text };
    });
    this.dueCount = dueNow(this.items, this.today).length;
    this.alert.publish(this.items); // la pestaña de la app se entera al instante
  }

  trackId = (_: number, r: Row) => r.item.id;
  isTemp(i: FollowupItem): boolean { return i.id.startsWith(TEMP_PREFIX); }
  fmt(iso: string): string { return fmtDay(iso); }

  // ---------- formulario ----------

  openAdd(): void {
    this.editingId = null;
    this.form = { name: '', due: addMonths(this.today, DEFAULT_MONTHS), note: '' };
    this.addRequestId = null;
    this.formError = null;
    this.doneOpenId = null;
    this.formOpen = true;
    this.scrollTop();
  }

  openEdit(i: FollowupItem): void {
    this.editingId = i.id;
    this.form = { name: i.name, due: i.due, note: i.note };
    this.formError = null;
    this.confirmDeleteId = null;
    this.doneOpenId = null;
    this.formOpen = true;
    this.scrollTop();
  }

  closeForm(): void { this.formOpen = false; }

  readonly presets = PRESETS;

  /** Atajo del formulario: toca contactar dentro de un tiempo (contando desde hoy). */
  setFormPreset(p: Preset): void { this.form.due = presetDate(p, this.today); }
  formPresetOn(p: Preset): boolean { return this.form.due === presetDate(p, this.today); }

  get canSave(): boolean { return !!this.form.name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(this.form.due); }

  // Guardar es "optimista": el formulario se cierra y el cambio se ve al instante; el envío va por detrás.
  // Si falla, se deshace y se vuelve a abrir el formulario con lo que había escrito.
  submit(): void {
    if (!this.canSave) return;
    const data = { name: this.form.name.trim(), due: this.form.due, note: this.form.note.trim() };
    this.formError = null;
    this.formOpen = false;
    if (this.editingId) this.saveEdit(this.editingId, data); else this.saveNew(data);
  }

  private saveNew(data: { name: string; due: string; note: string }): void {
    const requestId = this.addRequestId || (this.addRequestId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10));
    this.addRequestId = null;
    const temp: FollowupItem = { ...data, id: TEMP_PREFIX + requestId, createdAt: new Date().toISOString() };
    this.items = [...this.items, temp];
    this.recompute();
    this.highlight(temp.id);

    this.pendingWrites++;
    ++this.seq;
    this.subs.add(this.svc.addFollowup(data, requestId).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      if (this.destroyed) return;
      if (!res || res.error) {
        this.items = this.items.filter(x => x !== temp);
        this.recompute();
        if (this.formOpen) { this.say(`No se pudo guardar a ${data.name}. Vuelve a añadirlo.`); return; }
        this.editingId = null;
        this.form = { ...data };
        this.addRequestId = requestId; // reintentar reenvía el mismo id y el servidor no duplica
        this.formError = res?.error || 'No se pudo confirmar el guardado. Inténtalo de nuevo.';
        this.formOpen = true;
        return;
      }
      if (res.item) {
        const wasFlashing = this.justAddedId === temp.id;
        Object.assign(temp, res.item);
        if (wasFlashing) this.justAddedId = temp.id;
        this.recompute();
      } else {
        // Ya estaba guardada (reintento): se descarta la provisional y se lee la lista.
        this.items = this.items.filter(x => x !== temp);
        this.recompute();
        this.load();
      }
    }));
  }

  private saveEdit(id: string, data: { name: string; due: string; note: string }): void {
    this.update(id, data, 'No se pudo guardar el cambio.');
  }

  /** Cambia campos de un repaso: se ve al instante y, si el servidor no lo confirma, se deshace. */
  private update(id: string, patch: Partial<Pick<FollowupItem, 'name' | 'due' | 'note'>>, failText: string): void {
    const item = this.items.find(x => x.id === id);
    if (!item || this.busy.has(id)) return;
    const prev: FollowupItem = { ...item };
    Object.assign(item, patch);
    this.recompute();
    this.highlight(id);

    this.busy.add(id);
    this.pendingWrites++;
    ++this.seq;
    this.subs.add(this.svc.updateFollowup(id, patch).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      this.busy.delete(id);
      if (this.destroyed) return;
      if (!res || res.ok === false || res.error) {
        Object.assign(item, prev);
        this.recompute();
        this.say(failText);
        this.load();
      }
    }));
  }

  private highlight(id: string): void {
    this.justAddedId = id;
    setTimeout(() => document.getElementById('fu-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    setTimeout(() => { if (this.justAddedId === id) this.justAddedId = null; }, 2600);
  }

  private scrollTop(): void {
    setTimeout(() => document.querySelector('app-followup-board .scroll')?.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  // ---------- "Ya avisada": siguiente repaso ----------

  toggleDone(i: FollowupItem): void {
    this.confirmDeleteId = null;
    this.customDue = '';
    this.doneOpenId = this.doneOpenId === i.id ? null : i.id;
  }

  /** El siguiente contacto, dentro de un tiempo contando desde hoy (cuando se le contactó). */
  reschedulePreset(i: FollowupItem, p: Preset): void {
    this.reschedule(i, presetDate(p, this.today));
  }

  rescheduleCustom(i: FollowupItem): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(this.customDue)) this.reschedule(i, this.customDue);
  }

  private reschedule(i: FollowupItem, due: string): void {
    this.doneOpenId = null;
    this.update(i.id, { due }, 'No se pudo guardar la nueva fecha.');
    this.say(`${i.name}: próximo contacto el ${fmtDay(due)}`);
  }

  // ---------- quitar de la lista (se ve al instante; si falla, se deshace) ----------

  askDelete(i: FollowupItem): void {
    this.doneOpenId = null;
    this.confirmDeleteId = this.confirmDeleteId === i.id ? null : i.id;
  }

  confirmDelete(i: FollowupItem): void {
    if (this.busy.has(i.id)) return;
    this.confirmDeleteId = null;
    const before = this.items;
    this.items = this.items.filter(x => x.id !== i.id);
    this.recompute();

    this.busy.add(i.id);
    this.pendingWrites++;
    ++this.seq;
    this.subs.add(this.svc.deleteFollowup(i.id).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      this.busy.delete(i.id);
      if (this.destroyed) return;
      if (!res) {
        this.items = before;
        this.recompute();
        this.say('No se pudo quitar de la lista.');
        this.load();
      }
    }));
  }

  // ---------- aviso breve ----------

  private say(text: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = text;
    this.toastTimer = setTimeout(() => { this.toast = null; }, 3500);
  }
}
