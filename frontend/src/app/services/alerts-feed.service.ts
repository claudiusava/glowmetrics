import { Injectable } from '@angular/core';
import { interval } from 'rxjs';
import { GlowmetricsService } from './glowmetrics.service';
import { CleaningAlertService } from './cleaning-alert.service';
import { WaitlistAlertService } from './waitlist-alert.service';
import { FollowupAlertService } from './followup-alert.service';
import { FEED_EVERY_MS, FEED_FIRST_DELAY_MS, FEED_JITTER_MS, FEED_RETRY_MS, dueForRefresh } from './alerts-feed-logic';

/**
 * Trae en UNA petición lo que necesitan los números rojos de las pestañas (limpieza que toca, gente en
 * la lista de espera, contactos que tocan) y se lo reparte a los tres servicios de avisos. Antes cada
 * servicio preguntaba por su cuenta cada minuto: 180 peticiones por hora y pantalla al servidor.
 * Cada servicio ignora estos datos mientras su propia pantalla está abierta (ella manda sobre los suyos).
 */
@Injectable({ providedIn: 'root' })
export class AlertsFeedService {
  private lastAt = 0;
  private loading = false;
  private retried = false;

  constructor(
    private svc: GlowmetricsService,
    private cleaning: CleaningAlertService,
    private waitlist: WaitlistAlertService,
    private followups: FollowupAlertService,
  ) {
    setTimeout(() => this.load(), FEED_FIRST_DELAY_MS + Math.random() * FEED_JITTER_MS);
    interval(FEED_EVERY_MS).subscribe(() => { if (!document.hidden) this.load(); });
    document.addEventListener('visibilitychange', () => {
      if (dueForRefresh(Date.now(), this.lastAt, document.hidden)) this.load();
    });
  }

  private load(): void {
    if (this.loading) return;
    this.loading = true;
    this.svc.getAlerts().subscribe(res => {
      this.loading = false;
      if (!res || res.error) {
        // Una sola vez, un reintento pronto; si vuelve a fallar, espera al siguiente turno normal.
        if (!this.retried) {
          this.retried = true;
          setTimeout(() => this.load(), FEED_RETRY_MS);
        }
        return;
      }
      this.retried = false;
      this.lastAt = Date.now();
      // Cada parte llega null si falló en el servidor: lo que sí llegó se aplica.
      this.cleaning.feed(res.cleaning);
      this.waitlist.feed(res.waitlist);
      this.followups.feed(res.followups);
    });
  }
}
