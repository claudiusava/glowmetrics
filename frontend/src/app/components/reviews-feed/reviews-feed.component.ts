import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Review } from '../../models/review.model';

@Component({
  selector: 'app-reviews-feed',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reviews-feed.component.html',
  styleUrls: ['./reviews-feed.component.scss'],
})
export class ReviewsFeedComponent {
  @Input() reviews: Review[] = [];
  @Input() loading = true;

  stars(n: number): string {
    const v = Math.max(0, Math.min(5, Number(n) || 0));
    return '★'.repeat(Math.round(v)) + '☆'.repeat(5 - Math.round(v));
  }

  fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }
}
