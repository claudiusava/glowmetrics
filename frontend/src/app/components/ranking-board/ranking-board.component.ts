import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';
import { RankingCapture, RankingRow } from '../../models/review.model';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export interface Move {
  kind: 'up' | 'down' | 'same' | 'new';
  label: string;
  text: string;
}

@Component({
  selector: 'app-ranking-board',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ranking-board.component.html',
  styleUrls: ['./ranking-board.component.scss'],
})
export class RankingBoardComponent implements OnInit {
  data: RankingCapture | null = null;
  ours: RankingRow | null = null;
  maxReviews = 1;
  loading = true;
  failed = false;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.failed = false;
    // no-cache: el ranking cambia una vez al mes; que no se quede una copia vieja del navegador.
    fetch(environment.rankingUrl, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d: RankingCapture) => {
        if (!d || !Array.isArray(d.ranking) || !d.ranking.length) throw new Error('vacío');
        this.data = d;
        this.ours = d.ranking.find(r => r.es_nuestro) || null;
        this.maxReviews = Math.max(1, ...d.ranking.map(r => r.reseñas));
        this.loading = false;
      })
      .catch(() => {
        this.loading = false;
        this.failed = true;
      });
  }

  trackSlug = (_: number, r: RankingRow) => r.slug;

  // 2026 -> "2.026" (es-ES no agrupa los números de 4 cifras, y aquí se lee mejor con el punto).
  num(n: number): string {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  nota(n: number | null): string {
    return n == null ? '–' : n.toFixed(1).replace('.', ',');
  }

  medal(p: number): string {
    return p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : '';
  }

  barWidth(r: RankingRow): number {
    return Math.max(4, Math.round((r.reseñas / this.maxReviews) * 100));
  }

  // Puestos fuera del top 50 (si el centro propio no llega): se separa con "···".
  get ourOutside(): boolean {
    return !!this.ours && this.ours.puesto > 50;
  }

  get fecha(): string {
    return this.data ? this.dia(this.data.fecha, true) : '';
  }

  // Fecha de la captura con la que se comparan los cambios ("26 oct").
  get desde(): string {
    return this.data?.desde ? this.dia(this.data.desde, false) : '';
  }

  private dia(iso: string, conAnio: boolean): string {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return `${d} ${MESES[m - 1]}${conAnio ? ' ' + y : ''}`;
  }

  // Cambio de puesto respecto a la captura anterior (las flechitas de una clasificación).
  move(r: RankingRow): Move | null {
    if (!this.data?.desde) return null;
    if (r.puesto_anterior == null) return { kind: 'new', label: 'nuevo', text: 'Entra en el top 50' };
    const n = r.puesto_anterior - r.puesto;
    if (n > 0) return { kind: 'up', label: `▲${n}`, text: `Sube ${n} ${n === 1 ? 'puesto' : 'puestos'}` };
    if (n < 0) return { kind: 'down', label: `▼${-n}`, text: `Baja ${-n} ${n === -1 ? 'puesto' : 'puestos'}` };
    return { kind: 'same', label: '=', text: 'Mantiene el puesto' };
  }

  // Reseñas ganadas desde la captura anterior (null si no se sabe).
  gain(r: RankingRow): number | null {
    const antes = r['reseñas_anterior'];
    return this.data?.desde && antes != null ? r['reseñas'] - antes : null;
  }

  get comparing(): boolean { return !!this.data?.desde; }
}
