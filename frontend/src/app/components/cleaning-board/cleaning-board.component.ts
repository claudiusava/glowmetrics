import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';
import { GlowmetricsService } from '../../services/glowmetrics.service';
import { CleaningAlertService } from '../../services/cleaning-alert.service';
import {
  CleaningEntry, CleaningTask, ShareRow, TaskState, agoText, daysBetween, dirtColor, normalizeDate,
  shareStats, suggestWho, taskState, todayIso, todoNow,
} from './cleaning-logic';

// El registro lo usan dos personas en el mismo ordenador: se refresca solo mientras está abierto.
// Tras escribir se espera un poco antes de volver a leer, para que una lectura "vieja" no pise lo recién apuntado.
const POLL_MS = 60_000;
const QUIET_AFTER_WRITE_MS = 5_000;
const TEMP_PREFIX = 'tmp_';
const HISTORY_SHOWN = 40;
const FLASH_MS = 1600;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Todo lo que pinta una tarjeta de tarea, calculado de una vez. */
export interface TaskCard {
  task: CleaningTask;
  state: TaskState;
  color: string;           // color de la barra de suciedad
  who: string | null;      // "le toca a…" (solo si la tarea ya se acerca o toca)
}

@Component({
  selector: 'app-cleaning-board',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cleaning-board.component.html',
  styleUrls: ['./cleaning-board.component.scss'],
})
export class CleaningBoardComponent implements OnInit, OnDestroy {
  @ViewChild('historyPanel') historyPanel?: ElementRef<HTMLElement>;

  tasks: CleaningTask[] = [];
  staff: string[] = [];
  shares: Record<string, number> = {};
  entries: CleaningEntry[] = [];
  loading = true;
  loadFailed = false;
  today = todayIso();

  // Lo que se pinta (se recalcula en refresh(), nunca en la plantilla)
  cards: TaskCard[] = [];
  todo: TaskCard[] = [];             // lo que toca hacer ya (hoy o atrasado)
  nextUp: TaskCard | null = null;    // si no hay nada urgente: lo siguiente que va a tocar
  nothingYet = true;                 // todavía no se ha apuntado ninguna tarea
  share: { total: number; rows: ShareRow[] } = { total: 0, rows: [] };
  history: CleaningEntry[] = [];     // historial visible (con el filtro aplicado)
  historyTotal = 0;

  // Estado de la pantalla
  filter = '';                           // tarea filtrada en el historial ('' = todas)
  historyOpen = false;                   // en pantallas pequeñas el historial va plegado
  soloSuelo = new Set<string>();         // nota rápida "solo suelo" marcada
  otherDay = new Map<string, string>();  // "otro día": fecha elegida
  openOtherDay = new Set<string>();
  flash = new Set<string>();             // tarjetas recién apuntadas
  confirmDeleteId: string | null = null;
  toast: string | null = null;

  private seq = 0;
  private pendingWrites = 0;
  private lastWriteAt = 0;
  private destroyed = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Subscription();

  constructor(private svc: GlowmetricsService, private alert: CleaningAlertService) {}

  ngOnInit(): void {
    this.alert.setBoardOpen(true);
    this.load();
    this.subs.add(interval(POLL_MS).subscribe(() => {
      const t = todayIso(); // la pantalla puede pasar la noche abierta
      if (t !== this.today) { this.today = t; this.refresh(); }
      if (document.hidden || this.pendingWrites > 0) return;
      if (Date.now() - this.lastWriteAt < QUIET_AFTER_WRITE_MS) return;
      this.load();
    }));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.alert.setBoardOpen(false);
    this.subs.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  // ---------- lectura ----------

  private load(): void {
    const seq = ++this.seq;
    this.subs.add(this.svc.getCleaning().subscribe(res => {
      if (this.destroyed) return;
      if (!res || !Array.isArray(res.tasks)) {
        if (this.loading) {
          this.loadFailed = true;
          this.retryTimer = setTimeout(() => { if (!this.destroyed) this.load(); }, 5000);
        }
        return;
      }
      if (seq !== this.seq) return; // superada por una escritura posterior
      this.loading = false;
      this.loadFailed = false;
      this.tasks = res.tasks;
      this.staff = res.staff;
      this.shares = res.shares;
      // La fecha siempre como "AAAA-MM-DD"; un apunte sin fecha legible se ignora.
      this.entries = res.entries.map(e => ({ ...e, date: normalizeDate(e.date) })).filter(e => e.date);
      this.today = todayIso();
      this.refresh();
    }));
  }

  /** Recalcula todo lo que se pinta a partir de los apuntes. */
  private refresh(): void {
    const cardOf = (task: CleaningTask): TaskCard => {
      const state = taskState(task, this.entries, this.today);
      const who = state.level === 'ok' ? null : suggestWho(this.entries, this.staff, this.shares, task.id, this.today);
      return { task, state, color: dirtColor(state), who };
    };
    this.cards = this.tasks.map(cardOf);
    const urgent = new Set(todoNow(this.tasks, this.entries, this.today).map(x => x.task.id));
    this.todo = this.cards
      .filter(c => urgent.has(c.task.id))
      .sort((a, b) => (a.state.daysLeft ?? 0) - (b.state.daysLeft ?? 0));
    this.nextUp = this.todo.length ? null
      : this.cards.filter(c => c.state.daysLeft !== null)
          .sort((a, b) => (a.state.daysLeft ?? 0) - (b.state.daysLeft ?? 0))[0] ?? null;
    this.alert.publish(this.tasks, this.entries); // el aviso de la pestaña se actualiza al instante
    this.nothingYet = this.cards.every(c => c.state.level === 'none');
    this.share = shareStats(this.entries, this.staff, this.shares, this.today);

    const all = this.filter ? this.entries.filter(e => e.task === this.filter) : this.entries;
    this.historyTotal = all.length;
    this.history = all.slice(0, HISTORY_SHOWN);
  }

  // ---------- textos ----------

  taskOf(id: string): CleaningTask | undefined { return this.tasks.find(t => t.id === id); }

  entryDate(iso: string): string {
    const d = Number(iso.slice(8, 10)), m = Number(iso.slice(5, 7));
    return `${d} ${MESES[m - 1] || ''}`;
  }

  entryAgo(e: CleaningEntry): string { return agoText(Math.max(0, daysBetween(e.date, this.today))); }

  isTemp(e: CleaningEntry): boolean { return e.id.startsWith(TEMP_PREFIX); }

  trackCard = (_: number, c: TaskCard) => c.task.id;
  trackEntry = (_: number, e: CleaningEntry) => e.id;

  // ---------- historial ----------

  setFilter(id: string): void {
    this.filter = this.filter === id ? '' : id;
    this.confirmDeleteId = null;
    this.refresh();
  }

  toggleHistory(): void { this.historyOpen = !this.historyOpen; this.confirmDeleteId = null; }

  /** "Historial" de una tarjeta: filtra el historial por esa tarea y lo enseña. */
  showHistoryOf(t: CleaningTask): void {
    this.filter = t.id;
    this.historyOpen = true;
    this.confirmDeleteId = null;
    this.refresh();
    setTimeout(() => this.historyPanel?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  // ---------- acciones de cada tarjeta ----------

  toggleSoloSuelo(t: CleaningTask): void {
    if (this.soloSuelo.has(t.id)) this.soloSuelo.delete(t.id); else this.soloSuelo.add(t.id);
  }

  toggleOtherDay(t: CleaningTask): void {
    if (this.openOtherDay.has(t.id)) { this.openOtherDay.delete(t.id); this.otherDay.delete(t.id); }
    else this.openOtherDay.add(t.id);
  }

  setOtherDay(t: CleaningTask, value: string): void {
    if (value) this.otherDay.set(t.id, value); else this.otherDay.delete(t.id);
  }

  /** Apunta "hecho" ahora mismo (o el día elegido). Se ve al instante; si falla, se quita y se avisa. */
  done(t: CleaningTask, who: string): void {
    const date = this.otherDay.get(t.id) || this.today;
    if (date > this.today) { this.say('Esa fecha todavía no ha llegado.'); return; }
    const note = this.soloSuelo.has(t.id) ? 'Solo suelo' : '';
    const clientId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    const temp: CleaningEntry = { id: TEMP_PREFIX + clientId, task: t.id, who, date, note, createdAt: new Date().toISOString() };
    this.entries = [temp, ...this.entries].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

    // Tras apuntar, la tarjeta vuelve a su estado normal (sin la nota ni el día elegidos).
    this.soloSuelo.delete(t.id);
    this.otherDay.delete(t.id);
    this.openOtherDay.delete(t.id);
    this.refresh();
    this.flash.add(t.id);
    setTimeout(() => this.flash.delete(t.id), FLASH_MS);
    this.say(`✓ ${t.name}: apuntado a ${who}`);

    this.pendingWrites++;
    ++this.seq;
    this.subs.add(this.svc.addCleaning({ task: t.id, who, date, note }, clientId).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      if (this.destroyed) return;
      if (res && res.ok && res.item) {
        Object.assign(temp, res.item);
      } else if (res && res.ok) {
        // Ya estaba guardado (reintento): se lee la lista real.
        this.entries = this.entries.filter(e => e !== temp);
        this.refresh();
        this.load();
      } else {
        this.entries = this.entries.filter(e => e !== temp);
        this.refresh();
        this.say(res && res.error ? res.error : 'No se pudo guardar. Inténtalo de nuevo.');
      }
    }));
  }

  askDelete(e: CleaningEntry): void {
    this.confirmDeleteId = this.confirmDeleteId === e.id ? null : e.id;
  }

  confirmDelete(e: CleaningEntry): void {
    this.confirmDeleteId = null;
    const before = this.entries;
    this.entries = this.entries.filter(x => x.id !== e.id);
    this.refresh();
    this.pendingWrites++;
    ++this.seq;
    this.subs.add(this.svc.deleteCleaning(e.id).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      if (this.destroyed) return;
      if (!res) {
        this.entries = before;
        this.refresh();
        this.say('No se pudo borrar. Inténtalo de nuevo.');
      }
    }));
  }

  retry(): void { this.loading = true; this.loadFailed = false; this.load(); }

  private say(text: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = text;
    this.toastTimer = setTimeout(() => { this.toast = null; }, 3000);
  }
}
