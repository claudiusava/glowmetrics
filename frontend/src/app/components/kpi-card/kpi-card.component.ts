import { Component, Input, OnChanges, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AirtableKpi } from '../../models/review.model';

// Recuerda el último % conocido entre recargas de la página (localStorage)
// para poder mostrar la flechita de tendencia desde el primer momento,
// no solo tras el segundo refresco de la sesión actual.
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

  displayValue = '-- %';
  subText = 'Calculando…';
  bgColor = '#3fa66b';
  trend: 'up' | 'down' | null = null;
  trendDeltaLabel = '';

  private lastPct: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['kpi'] && this.kpi) {
      this.subText = `${this.kpi.citadas} citados de ${this.kpi.total} leads`;
      this.bgColor = this.getBackgroundColor(this.kpi.pct);
      if (this.kpi.total > 0) this.updateTrend(this.kpi.pct);
      this.animateValue(this.lastPct ?? this.kpi.pct, this.kpi.pct, 600);
    }
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

  private getBackgroundColor(value: number): string {
    if (value >= 40) return '#3fa66b';
    if (value >= 38) return '#6fbf8f';
    if (value >= 36) return '#c9c36b';
    if (value >= 34) return '#e0a24f';
    if (value >= 32) return '#d97a3a';
    if (value >= 30) return '#c84f3f';
    return '#a93a3a';
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
