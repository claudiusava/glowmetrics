import { Injectable } from '@angular/core';
import { interval } from 'rxjs';
import { GlowmetricsService } from './glowmetrics.service';
import { WaitItem } from '../models/review.model';

const POLL_MS = 60_000;
const SEEN_KEY = 'glowmetrics_wait_seen_v1';
const TEMP_PREFIX = 'tmp_';
const MAX_SEEN = 300;

/**
 * Avisa de las personas nuevas en la lista de espera (las que se apuntaron desde la última vez que
 * se miró esa sección en este ordenador), aunque se esté en otra pestaña. Se quita al abrirla.
 * Mientras la pantalla de Lista de espera está abierta, ella publica sus datos y todo se da por visto.
 */
@Injectable({ providedIn: 'root' })
export class WaitlistAlertService {
  /** Cuántas personas hay que todavía no se han visto. */
  unseen = 0;

  private ids: string[] = [];
  private seen: Set<string> | null = null;
  private viewing = false;

  constructor(private svc: GlowmetricsService) {
    this.seen = this.readSeen();
    this.load();
    interval(POLL_MS).subscribe(() => { if (!this.viewing && !document.hidden) this.load(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.viewing) this.load(); });
  }

  /** La pantalla de Lista de espera se abre o se cierra. Al salir, lo que había ya está visto. */
  setViewing(viewing: boolean): void {
    this.viewing = viewing;
    if (viewing) this.markSeen();
  }

  /** La pantalla de Lista de espera publica la lista cada vez que cambia. */
  publish(items: WaitItem[]): void {
    this.ids = items.filter(i => !i.id.startsWith(TEMP_PREFIX)).map(i => i.id);
    if (this.viewing) this.markSeen(); else this.recount();
  }

  private load(): void {
    this.svc.getWaitlist().subscribe(res => {
      if (!res || this.viewing) return;
      this.ids = res.map(i => i.id);
      // Primera vez en este ordenador: lo que ya hay no es "nuevo".
      if (this.seen === null) { this.seen = new Set(this.ids); this.saveSeen(); }
      this.recount();
    });
  }

  private recount(): void {
    this.unseen = this.seen ? this.ids.filter(id => !this.seen!.has(id)).length : 0;
  }

  private markSeen(): void {
    this.seen = new Set(this.ids);
    this.saveSeen();
    this.unseen = 0;
  }

  private readSeen(): Set<string> | null {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      return raw === null ? null : new Set(JSON.parse(raw) as string[]);
    } catch { return null; }
  }

  private saveSeen(): void {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...(this.seen ?? [])].slice(-MAX_SEEN))); } catch { /* ignorar */ }
  }
}
