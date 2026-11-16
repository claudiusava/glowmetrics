import { Injectable } from '@angular/core';
import { interval } from 'rxjs';
import { CleaningAlertService } from './cleaning-alert.service';
import { FollowupItem } from '../models/review.model';
import { dueNow } from '../components/followup-board/followup-logic';
import { todayIso } from '../components/cleaning-board/cleaning-logic';

const POLL_MS = 60_000;
const TEMP_PREFIX = 'tmp_';

/**
 * Cuántos repasos de clientas tocan ya (hoy o atrasados), para el número de la pestaña de la app y
 * para el título y el favicon del navegador (que comparten con la limpieza). Se apaga solo cuando se
 * marcan como avisados. Mientras la pantalla de Contactar está abierta, ella publica sus datos; si no,
 * llegan de AlertsFeedService (una sola petición para los tres avisos, cada pocos minutos).
 */
@Injectable({ providedIn: 'root' })
export class FollowupAlertService {
  /** Repasos que tocan ahora mismo. */
  count = 0;

  private items: FollowupItem[] = [];
  private viewing = false;

  constructor(private tabAlert: CleaningAlertService) {
    // Los datos llegan de AlertsFeedService (una sola petición para los tres avisos). Aquí solo se
    // recalcula con la fecha de hoy, sin red: pasa la medianoche y el contacto de mañana empieza a tocar.
    interval(POLL_MS).subscribe(() => this.recalc());
  }

  /** La pantalla de Repasos se abre o se cierra (mientras está abierta, ella manda sobre los datos). */
  setViewing(viewing: boolean): void { this.viewing = viewing; }

  /** La pantalla de Repasos publica la lista cada vez que cambia. */
  publish(items: FollowupItem[]): void {
    this.items = items.filter(i => !i.id.startsWith(TEMP_PREFIX));
    this.recalc();
  }

  /** Lista traída por AlertsFeedService (se ignora si la pantalla de Contactar está abierta). */
  feed(items: FollowupItem[] | null): void {
    if (this.viewing || !Array.isArray(items)) return;
    this.publish(items);
  }

  private recalc(): void {
    this.count = dueNow(this.items, todayIso()).length;
    this.tabAlert.setFollowups(this.count);
  }
}
