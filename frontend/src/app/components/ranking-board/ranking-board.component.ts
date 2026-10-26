import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';
import { RankingCapture, RankingRow } from '../../models/review.model';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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

  // El recuadro de "nuestro puesto" lleva hasta nuestra fila en la lista.
  goToOurs(): void {
    document.getElementById('rk-ours')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

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
    if (!this.data) return '';
    const [y, m, d] = this.data.fecha.split('-').map(Number);
    return y && m && d ? `${d} ${MESES[m - 1]} ${y}` : this.data.fecha;
  }
}
