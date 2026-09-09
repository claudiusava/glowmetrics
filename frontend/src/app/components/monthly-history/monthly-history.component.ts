import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MonthlyGoal, MonthlyHistoryEntry } from '../../models/review.model';

interface HistorySquare {
  key: string;
  state: 'met' | 'missed' | 'pending' | 'nodata';
  tooltip: string;
}

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

@Component({
  selector: 'app-monthly-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './monthly-history.component.html',
  styleUrls: ['./monthly-history.component.scss'],
})
export class MonthlyHistoryComponent implements OnChanges {
  @Input() history: MonthlyHistoryEntry[] = [];
  @Input() current: MonthlyGoal | null = null;

  squares: HistorySquare[] = [];

  ngOnChanges(_changes: SimpleChanges): void {
    // Mostramos 12 cuadraditos en total: los meses cerrados más recientes
    // + el mes en curso. El backend puede devolver hasta 12 meses cerrados,
    // así que recortamos a 11 para dejar sitio al mes actual.
    const closed = this.current
      ? this.history.filter(h => h.monthKey !== this.current!.monthKey)
      : this.history;
    const trimmed = closed.slice(-11);

    const squares: HistorySquare[] = trimmed.map(h => ({
      key: h.monthKey,
      state: h.met == null ? 'nodata' : h.met ? 'met' : 'missed',
      tooltip: h.count == null ? `${this.labelFor(h.monthKey)}: sin datos` : `${this.labelFor(h.monthKey)}: ${h.count} reseñas`,
    }));

    if (this.current) {
      const done = this.current.count >= this.current.goal;
      squares.push({
        key: this.current.monthKey,
        state: done ? 'met' : 'pending',
        tooltip: `${this.labelFor(this.current.monthKey)} (en curso): ${this.current.count}/${this.current.goal}`,
      });
    }

    this.squares = squares;
  }

  private labelFor(monthKey: string): string {
    const [y, m] = monthKey.split('-').map(Number);
    const name = MONTH_NAMES[(m || 1) - 1] || monthKey;
    return `${name} ${y}`;
  }
}
