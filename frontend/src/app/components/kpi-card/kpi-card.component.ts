import { Component, Input, OnChanges, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AirtableKpi } from '../../models/review.model';
import { KpiMessage, kpiMessage } from './kpi-message';

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

// Recuerda el último % conocido entre recargas de la página (localStorage)
// para poder mostrar la flechita de tendencia desde el primer momento,
// no solo tras el segundo refresco de la sesión actual.
// Extremos de la escala de color (7 tramos de 2 puntos).
const SCALE_MIN = 28;
const SCALE_MAX = 42;

const TREND_STORAGE_KEY = 'glowmetrics_kpi_trend_v1';

@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kpi-card.component.html',
  styleUrls: ['./kpi-card.component.scss'],
})
export class KpiCardComponent implements OnChanges {
  @Input() kpi: AirtableKpi | null = null;
  @Input() tip: string = 'Cargando consejo…';
  // El coste de publicidad solo se enseña si se pide (palabra secreta "coste" en la pantalla).
  @Input() showCost = false;

  displayValue = '-- %';
  subText = 'Calculando…';
  // Escala del indicador, en tramos iguales de 2 puntos: menos de 30 % ... 40 % o más.
  readonly scaleColors = ['#a93a3a', '#c84f3f', '#d97a3a', '#e0a24f', '#c9c36b', '#6fbf8f', '#3fa66b'];
  readonly lowPct = ((30 - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  readonly highPct = ((40 - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  markerPct = 0;
  message: KpiMessage | null = null; // lo que se dice según el tramo (motivar a mejorar)
  trend: 'up' | 'down' | null = null;
  trendDeltaLabel = '';

  // Coste de publicidad (por lead y por cita), con y sin IVA
  cost: { lead: string; leadVat: string; cita: string; citaVat: string } | null = null;

  private lastPct: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['kpi'] && this.kpi) {
      this.subText = `${this.kpi.citadas} citados de ${this.kpi.total} leads`;
      this.cost = this.buildCost(this.kpi);
      this.markerPct = Math.min(100, Math.max(0, ((this.kpi.pct - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
      this.message = kpiMessage(this.kpi.pct, this.kpi.total);
      if (this.kpi.total > 0) this.updateTrend(this.kpi.pct);
      this.animateValue(this.lastPct ?? this.kpi.pct, this.kpi.pct, 600);
    }
  }

  private buildCost(kpi: AirtableKpi) {
    const c = kpi.cost;
    if (!c || c.perLead == null) return null;
    const eur = (n: number | null) => (n == null ? '–' : EUR.format(n));
    return {
      lead: eur(c.perLead),
      leadVat: eur(c.perLeadVat),
      cita: eur(c.perCita),
      citaVat: eur(c.perCitaVat),
    };
  }

  private updateTrend(pct: number): void {
    let stored: number | null = null;
    try {
      const raw = localStorage.getItem(TREND_STORAGE_KEY);
      if (raw) stored = JSON.parse(raw).pct;
    } catch { /* sin localStorage, simplemente no mostramos tendencia */ }

    if (stored != null) {
      const diff = pct - stored;
      if (Math.abs(diff) >= 0.01) {
        this.trend = diff > 0 ? 'up' : 'down';
        this.trendDeltaLabel = `${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`;
      }
    }

    try {
      localStorage.setItem(TREND_STORAGE_KEY, JSON.stringify({ pct }));
    } catch { /* ignorar */ }
  }

  private animateValue(start: number, end: number, duration: number): void {
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      const val = start + (end - start) * eased;
      this.displayValue = `${val.toFixed(2)}%`;
      if (p < 1) requestAnimationFrame(step);
      else this.lastPct = end;
    };
    requestAnimationFrame(step);
  }
}
