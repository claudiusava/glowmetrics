import { Component, EventEmitter, HostListener, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { GlowmetricsService } from '../../services/glowmetrics.service';
import { WaitItem } from '../../models/review.model';
import { WaitlistAlertService } from '../../services/waitlist-alert.service';

// El centro abre de lunes a viernes. X = miércoles (como en un calendario).
const DAYS = [
  { k: 'L', full: 'Lunes' },
  { k: 'M', full: 'Martes' },
  { k: 'X', full: 'Miércoles' },
  { k: 'J', full: 'Jueves' },
  { k: 'V', full: 'Viernes' },
];
const DAY_ORDER = 'LMXJV';
const PART_ORDER = 'MT';

// Técnico con quien prefiere hacerse el tratamiento ('' = le es indiferente).
const TECHS = [
  { k: 'L', name: 'Laura' },
  { k: 'E', name: 'Elena' },
];

// La lista la usan a la vez varias personas: mientras está abierta se
// refresca sola. Tras escribir se espera un poco antes de volver a leer para
// que una lectura "vieja" no pise el cambio recién hecho.
const POLL_MS = 30_000;
const QUIET_AFTER_WRITE_MS = 5_000;
const TEMP_PREFIX = 'tmp_'; // clienta recién añadida cuyo guardado aún no ha vuelto

interface Toast { text: string; }

@Component({
  selector: 'app-waitlist-board',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './waitlist-board.component.html',
  styleUrls: ['./waitlist-board.component.scss'],
})
export class WaitlistBoardComponent implements OnInit, OnDestroy {
  // El modal padre necesita saber si hay un formulario abierto (Escape lo cierra a él, no al modal).
  @Output() formOpenChange = new EventEmitter<boolean>();

  readonly days = DAYS;
  readonly techs = TECHS;

  items: WaitItem[] = [];
  list: WaitItem[] = [];
  loading = true;
  loadFailed = false;

  // "Ha quedado un hueco": día y/o franja; las que encajan pasan delante.
  gapDay: string | null = null;
  gapPart: string | null = null;
  matchCount = 0;

  // Formulario (alta y edición)
  formOpen = false;
  editingId: string | null = null;
  form = { name: '', zones: '', days: '', parts: '', detail: '', tech: '' };
  saving = false;
  formError: string | null = null;
  private addRequestId: string | null = null;

  // Estado por elemento
  busy = new Set<string>();
  confirmDeleteId: string | null = null;
  justAddedId: string | null = null;
  toast: Toast | null = null;

  private seq = 0;
  private pendingWrites = 0;
  private lastWriteAt = 0;
  private destroyed = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Subscription();

  constructor(private svc: GlowmetricsService, private alert: WaitlistAlertService) {}

  // Escape cierra el formulario, no el modal. Se hace un instante después para
  // que el modal (que escucha lo mismo) vea todavía el formulario abierto.
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.formOpen) setTimeout(() => this.closeForm(), 0);
  }

  ngOnInit(): void {
    this.alert.setViewing(true);
    this.load();
    this.subs.add(interval(POLL_MS).subscribe(() => {
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
    this.subs.add(this.svc.getWaitlist().subscribe(res => {
      if (this.destroyed) return;
      if (!res) {
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
    const matches = (i: WaitItem) => this.matches(i);
    // Por orden de registro (la que se apuntó antes, arriba: tiene preferencia).
    // Con un hueco marcado, las que encajan van primero y mantienen ese orden.
    const ordered = [...this.items].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    this.alert.publish(this.items); // la pestaña de la app se entera al instante
    this.matchCount = ordered.filter(matches).length;
    this.list = this.gapActive
      ? [...ordered.filter(matches), ...ordered.filter(i => !matches(i))]
      : ordered;
  }

  trackId = (_: number, i: WaitItem) => i.id;

  // ---------- hueco libre ----------

  get gapActive(): boolean { return !!(this.gapDay || this.gapPart); }

  matches(i: WaitItem): boolean {
    const dayOk = !this.gapDay || !i.days || i.days.includes(this.gapDay);
    const partOk = !this.gapPart || !i.parts || i.parts.includes(this.gapPart);
    return dayOk && partOk;
  }

  toggleGapDay(k: string): void { this.gapDay = this.gapDay === k ? null : k; this.recompute(); }
  toggleGapPart(k: string): void { this.gapPart = this.gapPart === k ? null : k; this.recompute(); }
  clearGap(): void { this.gapDay = null; this.gapPart = null; this.recompute(); }

  // ---------- presentación ----------

  dayList(i: WaitItem): string[] { return i.days ? i.days.split('') : []; }
  dayFull(k: string): string { return DAYS.find(d => d.k === k)?.full ?? k; }

  // ---------- formulario ----------

  openAdd(): void {
    this.editingId = null;
    this.form = { name: '', zones: '', days: '', parts: '', detail: '', tech: '' };
    this.addRequestId = null;
    this.formError = null;
    this.setFormOpen(true);
    this.scrollTop();
  }

  openEdit(i: WaitItem): void {
    this.editingId = i.id;
    this.form = { name: i.name, zones: i.zones, days: i.days, parts: i.parts, detail: i.detail, tech: i.tech || '' };
    this.formError = null;
    this.confirmDeleteId = null;
    this.setFormOpen(true);
    this.scrollTop();
  }

  closeForm(): void {
    if (this.saving) return;
    this.setFormOpen(false);
  }

  private setFormOpen(v: boolean): void {
    this.formOpen = v;
    this.formOpenChange.emit(v);
  }

  toggleFormDay(k: string): void { this.form.days = this.toggleLetter(this.form.days, k, DAY_ORDER); }
  toggleFormPart(k: string): void { this.form.parts = this.toggleLetter(this.form.parts, k, PART_ORDER); }
  setTech(k: string): void { this.form.tech = k; }
  techName(k: string): string { return TECHS.find(t => t.k === k)?.name ?? ''; }

  private toggleLetter(s: string, k: string, order: string): string {
    const set = new Set(s.split(''));
    if (set.has(k)) set.delete(k); else set.add(k);
    return order.split('').filter(c => set.has(c)).join('');
  }

  // Guardar es "optimista": el formulario se cierra y la clienta aparece al
  // instante; el envío va por detrás. Si falla, se deshace y se vuelve a abrir
  // el formulario con lo que había escrito.
  submit(): void {
    if (this.saving || !this.form.name.trim()) return;
    const data = { ...this.form, name: this.form.name.trim() };
    this.formError = null;
    this.setFormOpen(false);
    if (this.editingId) this.saveEdit(this.editingId, data); else this.saveNew(data);
  }

  isTemp(i: WaitItem): boolean { return i.id.startsWith(TEMP_PREFIX); }

  private saveNew(data: { name: string; zones: string; days: string; parts: string; detail: string; tech: string }): void {
    const requestId = this.addRequestId || (this.addRequestId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10));
    this.addRequestId = null;
    const now = new Date().toISOString();
    const temp: WaitItem = { ...data, id: TEMP_PREFIX + requestId, createdAt: now, updatedAt: now };
    this.items = [...this.items, temp];
    this.recompute();
    this.highlight(temp.id);

    this.pendingWrites++;
    ++this.seq;
    let tries = 0;
    const fail = (msg: string) => {
      this.items = this.items.filter(x => x !== temp);
      this.recompute();
      if (this.formOpen) { this.say(`No se pudo guardar a ${data.name}. Vuelve a añadirla.`); return; }
      this.editingId = null;
      this.form = { ...data };
      this.addRequestId = requestId; // reintentar reenvía el mismo id y el servidor no duplica
      this.formError = msg;
      this.setFormOpen(true);
    };
    const send = () => this.subs.add(this.svc.addWaitItem(data, requestId).subscribe(res => {
      if (this.destroyed) return;
      // El servidor deja 1,5 s entre altas: si justo coincide, se reintenta solo.
      if (res?.error && res.error.startsWith('Espera') && tries++ < 3) { setTimeout(send, 1700); return; }
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      this.jobDone(temp.id);
      if (!res) return fail('No se pudo confirmar el guardado. Inténtalo de nuevo.');
      if (res.error) return fail(res.error);
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
    this.enqueue(temp.id, send);
  }

  private saveEdit(id: string, data: { name: string; zones: string; days: string; parts: string; detail: string; tech: string }): void {
    const item = this.items.find(x => x.id === id);
    if (!item) return;
    const prev: WaitItem = { ...item };
    Object.assign(item, data, { updatedAt: new Date().toISOString() });
    this.recompute();
    this.highlight(id);

    this.pendingWrites++;
    ++this.seq;
    this.enqueue(id, () => this.subs.add(this.svc.updateWaitItem(id, data).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      this.jobDone(id);
      if (this.destroyed) return;
      if (!res || res.ok === false || res.error) {
        Object.assign(item, prev);
        this.recompute();
        this.say('No se pudo guardar el cambio.');
        this.load();
      }
    })));
  }

  private highlight(id: string): void {
    this.justAddedId = id;
    setTimeout(() => document.getElementById('wl-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    setTimeout(() => { if (this.justAddedId === id) this.justAddedId = null; }, 2600);
  }

  private scrollTop(): void {
    setTimeout(() => document.querySelector('app-waitlist-board .scroll')?.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  // ---------- borrar (se ve al instante; si falla, se deshace) ----------

  // Los cambios sobre una misma clienta se envían de uno en uno y en orden
  // (p. ej. editar y borrar seguidos, aunque el guardado anterior siga en camino).
  private queues = new Map<string, Array<() => void>>();

  private enqueue(id: string, job: () => void): void {
    this.busy.add(id);
    const q = this.queues.get(id);
    if (q) { q.push(job); return; }
    this.queues.set(id, []);
    job();
  }

  private jobDone(id: string): void {
    const job = this.queues.get(id)?.shift();
    if (job) { job(); return; }
    this.queues.delete(id);
    this.busy.delete(id);
  }

  askDelete(i: WaitItem): void { this.confirmDeleteId = this.confirmDeleteId === i.id ? null : i.id; }

  confirmDelete(i: WaitItem): void {
    this.confirmDeleteId = null;
    const before = this.items;
    this.items = this.items.filter(x => x.id !== i.id);
    this.recompute();

    this.pendingWrites++;
    ++this.seq;
    this.enqueue(i.id, () => this.subs.add(this.svc.deleteWaitItem(i.id).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      this.jobDone(i.id);
      if (this.destroyed) return;
      if (!res) {
        this.items = before;
        this.recompute();
        this.say('No se pudo borrar.');
        this.load();
      }
    })));
  }

  // ---------- aviso breve ----------

  private say(text: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = { text };
    this.toastTimer = setTimeout(() => { this.toast = null; }, 3500);
  }
}
