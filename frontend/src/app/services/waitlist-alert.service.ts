import { Injectable } from '@angular/core';
import { interval } from 'rxjs';
import { GlowmetricsService } from './glowmetrics.service';
import { WaitItem } from '../models/review.model';

const POLL_MS = 60_000;
const TEMP_PREFIX = 'tmp_';

/**
 * Cuántas personas hay en la lista de espera, para el número de la pestaña: se ve en cualquier sección
 * y se apaga solo cuando la lista queda vacía. Mientras la pantalla de Lista de espera está abierta,
 * ella publica sus datos; si no, se leen cada minuto (con la pestaña del navegador a la vista).
 */
@Injectable({ providedIn: 'root' })
export class WaitlistAlertService {
  /** Personas en la lista de espera ahora mismo. */
  count = 0;

  private viewing = false;

  constructor(private svc: GlowmetricsService) {
    this.load();
    interval(POLL_MS).subscribe(() => { if (!this.viewing && !document.hidden) this.load(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.viewing) this.load(); });
  }

  /** La pantalla de Lista de espera se abre o se cierra (mientras está abierta, ella manda sobre los datos). */
  setViewing(viewing: boolean): void { this.viewing = viewing; }

  /** La pantalla de Lista de espera publica la lista cada vez que cambia. */
  publish(items: WaitItem[]): void {
    this.count = items.filter(i => !i.id.startsWith(TEMP_PREFIX)).length;
  }

  private load(): void {
    this.svc.getWaitlist().subscribe(res => {
      if (!res || this.viewing) return;
      this.count = res.length;
    });
  }
}
