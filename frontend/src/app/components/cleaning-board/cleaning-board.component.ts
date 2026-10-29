import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';
import { GlowmetricsService } from '../../services/glowmetrics.service';
import { CleaningData } from '../../models/review.model';
import {
  CleaningEntry, CleaningTask, ShareRow, TaskState, agoText, daysBetween, normalizeDate, shareStats, suggestWho, taskState, todayIso,
} from './cleaning-logic';

// El registro lo usan dos personas en el mismo ordenador: se refresca solo mientras está abierto.
// Tras escribir se espera un poco antes de volver a leer, para que una lectura "vieja" no pise lo recién apuntado.
const POLL_MS = 60_000;
const QUIET_AFTER_WRITE_MS = 5_000;
const TEMP_PREFIX = 'tmp_';
const HISTORY_SHOWN = 8;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

@Component({
  selector: 'app-cleaning-board',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cleaning-board.component.html',
  styleUrls: ['./cleaning-board.component.scss'],
})
export class CleaningBoardComponent implements OnInit, OnDestroy {
  tasks: CleaningTask[] = [];
  staff: string[] = [];
  shares: Record<string, number> = {};
  entries: CleaningEntry[] = [];
  loading = true;
  loadFailed = false;
  today = todayIso();

  // Estado de cada tarjeta
  expanded = new Set<string>();     // historial abierto
  soloSuelo = new Set<string>();    // nota rápida "solo suelo" marcada
  otherDay = new Map<string, string>(); // "otro día": fecha elegida (vacío = hoy)
  openOtherDay = new Set<string>();
  confirmDeleteId: string | null = null;
  toast: string | null = null;

  private seq = 0;
  private pendingWrites = 0;
  private lastWriteAt = 0;
  private destroyed = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Subscription();

  constructor(private svc: GlowmetricsService) {}

  ngOnInit(): void {
    this.load();
    this.subs.add(interval(POLL_MS).subscribe(() => {
      this.today = todayIso(); // la pantalla puede pasar la noche abierta
      if (document.hidden || this.pendingWrites > 0) return;
      if (Date.now() - this.lastWriteAt < QUIET_AFTER_WRITE_MS) return;
      this.load();
    }));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
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
    }));
  }

  // ---------- lo que se pinta ----------

  state(t: CleaningTask): TaskState { return taskState(t, this.entries, this.today); }

  /** Reparto de los últimos 90 días (lo que ha hecho cada una frente a lo que le corresponde). */
  get share(): { total: number; rows: ShareRow[] } {
    return shareStats(this.entries, this.staff, this.shares, this.today);
  }

  /** "Toca a…": solo si la tarea ya toca (o nunca se ha hecho). */
  suggestion(t: CleaningTask): string | null {
    const lvl = this.state(t).level;
    return lvl === 'ok' ? null : suggestWho(this.entries, this.staff, this.shares, t.id, this.today);
  }

  levelText(t: CleaningTask): string {
    const lvl = this.state(t).level;
    return lvl === 'late' ? 'Atrasada' : lvl === 'due' ? 'Toca ya' : '';
  }

  history(t: CleaningTask): CleaningEntry[] {
    return this.entries.filter(e => e.task === t.id).slice(0, HISTORY_SHOWN);
  }

  hasMore(t: CleaningTask): boolean {
    return this.entries.filter(e => e.task === t.id).length > HISTORY_SHOWN;
  }

  entryDate(iso: string): string {
    const d = Number(iso.slice(8, 10)), m = Number(iso.slice(5, 7));
    return `${d} ${MESES[m - 1] || ''}`;
  }

  entryAgo(e: CleaningEntry): string { return agoText(Math.max(0, daysBetween(e.date, this.today))); }

  isTemp(e: CleaningEntry): boolean { return e.id.startsWith(TEMP_PREFIX); }

  trackTask = (_: number, t: CleaningTask) => t.id;
  trackEntry = (_: number, e: CleaningEntry) => e.id;

  // ---------- acciones de cada tarjeta ----------

  toggleHistory(t: CleaningTask): void {
    if (this.expanded.has(t.id)) this.expanded.delete(t.id); else this.expanded.add(t.id);
    this.confirmDeleteId = null;
  }

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
        this.load();
      } else {
        this.entries = this.entries.filter(e => e !== temp);
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
    this.pendingWrites++;
    ++this.seq;
    this.subs.add(this.svc.deleteCleaning(e.id).subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      if (this.destroyed) return;
      if (!res) {
        this.entries = before;
        this.say('No se pudo borrar. Inténtalo de nuevo.');
      }
    }));
  }

  retry(): void { this.loading = true; this.loadFailed = false; this.load(); }

  private say(text: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = text;
    this.toastTimer = setTimeout(() => { this.toast = null; }, 3500);
  }
}
