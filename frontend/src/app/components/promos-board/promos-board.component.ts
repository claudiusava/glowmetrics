import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription, interval } from 'rxjs';
import { GlowmetricsService } from '../../services/glowmetrics.service';
import { PromoOffer, PromoResult } from '../../models/review.model';
import {
  PromoCard, PromoSectionView, PromoTotals, buildSections, campaignText, newRequestId, offerName, promoErrorText, promoTotals,
} from './promos-logic';

// Mientras la pantalla está abierta se refresca sola (la usan varias personas a la vez). Tras escribir se
// espera un poco antes de volver a leer, para que una lectura "vieja" no pise lo recién apuntado.
const POLL_MS = 60_000;
const QUIET_AFTER_WRITE_MS = 5_000;
const COOLDOWN_MS = 700; // evita vender dos veces con un doble toque sin querer

/**
 * Unidades vendidas de las ofertas con límite por centro (Black Friday): cada tarjeta enseña cuántas quedan,
 * "Vendida" resta una y "Deshacer" la devuelve. Los números reales viven en el servidor (hoja "Ofertas") y
 * este lo rechaza si se intenta vender una agotada, aunque dos personas pulsen a la vez.
 */
@Component({
  selector: 'app-promos-board',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './promos-board.component.html',
  styleUrls: ['./promos-board.component.scss'],
})
export class PromosBoardComponent implements OnInit, OnDestroy {
  offers: PromoOffer[] = [];
  sections: PromoSectionView[] = [];
  totals: PromoTotals = { sold: 0, limit: 0, soldOut: 0, low: 0 };
  campaignText = '';
  campaignName = '';
  loading = true;
  loadFailed = false;

  // "Ajustar": corregir a mano el número de vendidas de una tarjeta
  adjustId: string | null = null;
  adjustValue: number | null = null;

  toast: string | null = null;

  // Lo que el servidor dijo la última vez + lo que se acaba de pulsar y aún no ha vuelto confirmado.
  // Lo que se ve es la suma: así el número cambia al instante y varias pulsaciones seguidas no se pisan.
  private server: Record<string, number> = {};
  private pending: Record<string, number> = {};
  private cooling = new Set<string>();

  private pendingWrites = 0;
  private overlapped = false;      // se lanzaron escrituras mientras otra seguía en el aire
  private needReload = false;      // alguna escritura no obtuvo respuesta: hay que preguntar cómo quedó
  private lastCounts: Record<string, number> | null = null;
  private seq = 0;
  private lastWriteAt = 0;
  private destroyed = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Subscription();

  constructor(private svc: GlowmetricsService) {}

  @HostListener('document:keydown.escape')
  onEscape(): void { this.adjustId = null; }

  ngOnInit(): void {
    this.load();
    this.subs.add(interval(POLL_MS).subscribe(() => {
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
    this.subs.add(this.svc.getPromos().subscribe(res => {
      if (this.destroyed) return;
      if (!res || res.error || !res.offers || !res.sold) {
        // Sin respuesta (o el servidor no pudo leer): se conserva lo último; si aún no hay nada, se reintenta pronto.
        if (this.loading) {
          this.loadFailed = true;
          this.retryTimer = setTimeout(() => { if (!this.destroyed) this.load(); }, 5000);
        }
        return;
      }
      if (seq !== this.seq || this.pendingWrites > 0) return; // superada por una escritura posterior
      this.loading = false;
      this.loadFailed = false;
      this.offers = res.offers;
      this.server = { ...res.sold };
      this.campaignName = res.campaign?.name || '';
      this.campaignText = campaignText(res.campaign?.from ?? '', res.campaign?.to ?? '');
      this.recompute();
    }));
  }

  /** Lo que se ve de una oferta: lo del servidor más lo recién pulsado. */
  private shown(id: string): number {
    return Math.max(0, (this.server[id] ?? 0) + (this.pending[id] ?? 0));
  }

  private recompute(): void {
    this.sections = buildSections(this.offers, id => this.shown(id));
    this.totals = promoTotals(this.sections);
  }

  trackSection = (_: number, s: PromoSectionView) => s.section;
  trackGroup = (_: number, g: { name: string }) => g.name;
  trackCard = (_: number, c: PromoCard) => c.offer.id;
  name(o: PromoOffer): string { return offerName(o); }

  // ---------- vender, deshacer, ajustar ----------

  sell(c: PromoCard): void {
    const o = c.offer;
    if (o.closed || this.cooling.has(o.id) || this.shown(o.id) >= o.limit) return;
    this.cooldown(o.id);
    this.change(o, +1, this.svc.promoSell(o.id, newRequestId()), `✓ ${offerName(o)}: quedan ${Math.max(0, o.limit - this.shown(o.id) - 1)}`);
  }

  undo(c: PromoCard): void {
    const o = c.offer;
    if (o.closed || this.cooling.has(o.id) || this.shown(o.id) <= 0) return;
    this.cooldown(o.id);
    this.change(o, -1, this.svc.promoUndo(o.id, newRequestId()), `↶ ${offerName(o)}: venta deshecha, quedan ${o.limit - this.shown(o.id) + 1}`);
  }

  openAdjust(c: PromoCard): void {
    if (c.closed) return;
    this.adjustId = this.adjustId === c.offer.id ? null : c.offer.id;
    this.adjustValue = c.sold;
  }

  canAdjust(c: PromoCard): boolean {
    const v = this.adjustValue;
    return v !== null && Number.isInteger(v) && v >= 0 && v <= c.offer.limit;
  }

  saveAdjust(c: PromoCard): void {
    if (!this.canAdjust(c)) return;
    const o = c.offer;
    const target = this.adjustValue as number;
    this.adjustId = null;
    const delta = target - this.shown(o.id);
    if (delta === 0) return;
    this.change(o, delta, this.svc.promoSet(o.id, target, newRequestId()), `✎ ${offerName(o)}: ajustada a ${target} vendidas, quedan ${o.limit - target}`);
  }

  private cooldown(id: string): void {
    this.cooling.add(id);
    setTimeout(() => this.cooling.delete(id), COOLDOWN_MS);
  }

  /**
   * El cambio se ve al instante; el envío va por detrás. Mientras haya envíos en el aire no se toca lo que
   * dijo el servidor (las respuestas pueden llegar en otro orden); cuando se asientan todos, si fue uno solo
   * se usan los números exactos que devolvió y, si no, se vuelve a preguntar cómo ha quedado.
   */
  private change(o: PromoOffer, delta: number, req$: Observable<PromoResult | null>, okText: string): void {
    this.pending[o.id] = (this.pending[o.id] ?? 0) + delta;
    this.recompute();
    this.say(okText);
    if (this.pendingWrites > 0) this.overlapped = true;
    this.pendingWrites++;
    ++this.seq;

    this.subs.add(req$.subscribe(res => {
      this.pendingWrites--;
      this.lastWriteAt = Date.now();
      if (this.destroyed) return;
      if (!res) {
        // No se sabe si llegó: se quita lo pulsado de la vista y se pregunta al servidor cómo ha quedado.
        this.pending[o.id] = (this.pending[o.id] ?? 0) - delta;
        this.needReload = true;
        this.say('No se pudo confirmar. Mira el número antes de volver a pulsar.');
      } else {
        if (res.error) {
          this.pending[o.id] = (this.pending[o.id] ?? 0) - delta; // rechazada: no cuenta
          this.say(promoErrorText(res.error, o));
        }
        if (res.counts) this.lastCounts = res.counts;
      }
      if (this.pendingWrites === 0) this.settle();
      else this.recompute();
    }));
  }

  private settle(): void {
    const counts = this.lastCounts;
    const exact = !this.overlapped && !this.needReload && counts !== null;
    if (exact && counts) {
      this.server = { ...this.server, ...counts };
    } else {
      // Varias a la vez o sin confirmar: se da por buena la suma mientras llega la lectura real.
      for (const id of Object.keys(this.pending)) this.server[id] = Math.max(0, (this.server[id] ?? 0) + this.pending[id]);
    }
    this.pending = {};
    this.overlapped = false;
    this.lastCounts = null;
    const reload = this.needReload || !exact;
    this.needReload = false;
    this.recompute();
    if (reload) this.load();
  }

  // ---------- aviso breve ----------

  private say(text: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = text;
    this.toastTimer = setTimeout(() => { this.toast = null; }, 3500);
  }
}
