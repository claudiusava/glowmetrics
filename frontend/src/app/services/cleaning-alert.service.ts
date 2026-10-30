import { Injectable } from '@angular/core';
import { interval } from 'rxjs';
import { GlowmetricsService } from './glowmetrics.service';
import { CleaningEntry, CleaningTask, normalizeDate, taskState, todayIso, todoNow } from '../components/cleaning-board/cleaning-logic';

const POLL_MS = 60_000;
const BLINK_MS = 1200;
const STAR = 'M32 13 L36.7 25.8 L50.5 27.3 L39.9 36.1 L43.3 49.6 L32 42 L20.7 49.6 L24.1 36.1 L13.5 27.3 L27.3 25.8 Z';

/**
 * Avisa de las limpiezas que tocan, aunque no se esté en la sección Limpieza: el número se pinta en
 * la pestaña de la app y en la pestaña del navegador (título y favicon). No se quita hasta que se
 * apunta la limpieza. Los datos los publica la propia pantalla de Limpieza cuando está abierta;
 * si no, se leen cada minuto.
 */
@Injectable({ providedIn: 'root' })
export class CleaningAlertService {
  /** Nombres de las tareas que tocan ya (hoy o atrasadas). */
  pending: string[] = [];

  private tasks: CleaningTask[] = [];
  private entries: CleaningEntry[] = [];
  private boardOpen = false;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private blinkOn = false;
  private readonly baseTitle = document.title || 'GlowMetrics';
  private readonly iconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  private readonly baseIcon = this.iconLink?.getAttribute('href') ?? '';

  constructor(private svc: GlowmetricsService) {
    this.load();
    interval(POLL_MS).subscribe(() => {
      this.recalc(); // pasa la medianoche con la pantalla abierta
      if (!this.boardOpen && !document.hidden) this.load();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !this.boardOpen) this.load();
      this.paint();
    });
  }

  /** La pantalla de Limpieza dice que está abierta (ella manda sobre los datos). */
  setBoardOpen(open: boolean): void { this.boardOpen = open; }

  /** La pantalla de Limpieza publica sus datos cada vez que cambian (también los apuntes recién hechos). */
  publish(tasks: CleaningTask[], entries: CleaningEntry[]): void {
    this.tasks = tasks;
    this.entries = entries;
    this.recalc();
  }

  private load(): void {
    this.svc.getCleaning().subscribe(res => {
      if (this.boardOpen || !res || !Array.isArray(res.tasks)) return;
      this.publish(res.tasks, res.entries.map(e => ({ ...e, date: normalizeDate(e.date) })).filter(e => e.date));
    });
  }

  private recalc(): void {
    const today = todayIso();
    const names = todoNow(this.tasks, this.entries, today).map(x => x.task.name);
    const changed = names.join('|') !== this.pending.join('|');
    this.pending = names;
    if (changed) this.paint();
  }

  // ---------- pestaña del navegador ----------

  private paint(): void {
    const n = this.pending.length;
    if (this.blinkTimer) { clearInterval(this.blinkTimer); this.blinkTimer = null; }
    if (!n) { this.show(false, this.baseTitle); return; }
    // Pestaña a la vista: aviso fijo. Pestaña escondida: parpadea para llamar la atención.
    const quiet = `(${n}) 🧹 Toca limpiar`;
    if (!document.hidden) { this.show(true, quiet); return; }
    this.blinkOn = true;
    this.show(true, quiet);
    this.blinkTimer = setInterval(() => {
      this.blinkOn = !this.blinkOn;
      this.show(this.blinkOn, this.blinkOn ? quiet : `🔴 ¡Limpieza pendiente!`);
    }, BLINK_MS);
  }

  private show(badge: boolean, title: string): void {
    document.title = title;
    if (!this.iconLink) return;
    if (!badge) { this.iconLink.setAttribute('href', this.baseIcon); return; }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="#f7307d"/><stop offset="100%" stop-color="#e0a24f"/></linearGradient></defs>` +
      `<rect width="64" height="64" rx="16" fill="url(#g)"/><path d="${STAR}" fill="#ffffff"/>` +
      `<circle cx="48" cy="16" r="15" fill="#ffffff"/><circle cx="48" cy="16" r="11.5" fill="#e11d48"/></svg>`;
    this.iconLink.setAttribute('type', 'image/svg+xml');
    this.iconLink.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
  }
}
