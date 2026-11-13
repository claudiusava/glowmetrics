import { Injectable } from '@angular/core';
import { interval } from 'rxjs';
import { GlowmetricsService } from './glowmetrics.service';
import { CleaningAlertService } from './cleaning-alert.service';
import { FollowupItem } from '../models/review.model';
import { dueNow } from '../components/followup-board/followup-logic';
import { todayIso } from '../components/cleaning-board/cleaning-logic';

const POLL_MS = 60_000;
const TEMP_PREFIX = 'tmp_';

/**
 * Cuántos repasos de clientas tocan ya (hoy o atrasados), para el número de la pestaña de la app y
 * para el título y el favicon del navegador (que comparten con la limpieza). Se apaga solo cuando se
 * marcan como avisados. Mientras la pantalla de Repasos está abierta, ella publica sus datos; si no,
 * se leen cada minuto (con la pestaña del navegador a la vista).
 */
@Injectable({ providedIn: 'root' })
export class FollowupAlertService {
  /** Repasos que tocan ahora mismo. */
  count = 0;

  private items: FollowupItem[] = [];
  private viewing = false;

  constructor(private svc: GlowmetricsService, private tabAlert: CleaningAlertService) {
    this.load();
    interval(POLL_MS).subscribe(() => {
      this.recalc(); // pasa la medianoche con la pantalla abierta: el repaso de mañana empieza a tocar
      if (!this.viewing && !document.hidden) this.load();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.viewing) this.load(); });
  }

  /** La pantalla de Repasos se abre o se cierra (mientras está abierta, ella manda sobre los datos). */
  setViewing(viewing: boolean): void { this.viewing = viewing; }

  /** La pantalla de Repasos publica la lista cada vez que cambia. */
  publish(items: FollowupItem[]): void {
    this.items = items.filter(i => !i.id.startsWith(TEMP_PREFIX));
    this.recalc();
  }

  private load(): void {
    this.svc.getFollowups().subscribe(res => {
      if (!res || this.viewing || !Array.isArray(res)) return;
      this.publish(res);
    });
  }

  private recalc(): void {
    this.count = dueNow(this.items, todayIso()).length;
    this.tabAlert.setFollowups(this.count);
  }
}
