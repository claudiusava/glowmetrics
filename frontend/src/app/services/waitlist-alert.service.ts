import { Injectable } from '@angular/core';
import { WaitItem } from '../models/review.model';

const TEMP_PREFIX = 'tmp_';

/**
 * Cuántas personas hay en la lista de espera, para el número de la pestaña: se ve en cualquier sección
 * y se apaga solo cuando la lista queda vacía. Mientras la pantalla de Lista de espera está abierta,
 * ella publica sus datos; si no, llegan de AlertsFeedService (una sola petición para los tres avisos).
 */
@Injectable({ providedIn: 'root' })
export class WaitlistAlertService {
  /** Personas en la lista de espera ahora mismo. */
  count = 0;

  private viewing = false;

  /** La pantalla de Lista de espera se abre o se cierra (mientras está abierta, ella manda sobre los datos). */
  setViewing(viewing: boolean): void { this.viewing = viewing; }

  /** La pantalla de Lista de espera publica la lista cada vez que cambia. */
  publish(items: WaitItem[]): void {
    this.count = items.filter(i => !i.id.startsWith(TEMP_PREFIX)).length;
  }

  /** Lista traída por AlertsFeedService (se ignora si la pantalla de Lista de espera está abierta). */
  feed(items: WaitItem[] | null): void {
    if (this.viewing || !Array.isArray(items)) return;
    this.count = items.length;
  }
}
