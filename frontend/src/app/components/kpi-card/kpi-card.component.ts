import { Component, Input, OnChanges, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AirtableKpi } from '../../models/review.model';

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

  private lastPct: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['kpi'] && this.kpi) {
      this.subText = `${this.kpi.citadas} citados de ${this.kpi.total} leads`;
      this.bgColor = this.getBackgroundColor(this.kpi.pct);
      this.animateValue(this.lastPct ?? this.kpi.pct, this.kpi.pct, 600);
    }
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
