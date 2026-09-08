import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { ReviewsResponse, MonthlyGoal, AirtableKpi } from '../models/review.model';

// Apps Script (ContentService) no manda cabeceras CORS, así que consumimos
// su API vía JSONP en vez de XHR/fetch normal.
@Injectable({ providedIn: 'root' })
export class GlowmetricsService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  initialize(): Observable<ReviewsResponse> {
    return this.http.jsonp<ReviewsResponse>(`${this.api}?route=initialize`, 'callback').pipe(
      catchError(() => of({ totalCount: 0, reviews: [] }))
    );
  }

  checkForUpdates(): Observable<ReviewsResponse> {
    return this.http.jsonp<ReviewsResponse>(`${this.api}?route=updates`, 'callback').pipe(
      catchError(() => of({ totalCount: 0, reviews: [], updated: false }))
    );
  }

  getMonthlyGoal(): Observable<MonthlyGoal> {
    return this.http.jsonp<MonthlyGoal>(`${this.api}?route=monthly-goal`, 'callback').pipe(
      catchError(() => of({ count: 0, goal: 20, monthKey: '' }))
    );
  }

  getSalesTips(): Observable<string[]> {
    return this.http.jsonp<string[]>(`${this.api}?route=sales-tips`, 'callback').pipe(
      catchError(() => of([]))
    );
  }

  getAirtableKpi(): Observable<AirtableKpi> {
    return this.http.jsonp<AirtableKpi>(`${this.api}?route=airtable-kpi`, 'callback').pipe(
      catchError(() => of({ pct: 32.15, total: 0, citadas: 0, stale: true, updatedAt: '' }))
    );
  }

  // Refresco manual bajo demanda (código secreto). Cooldown real en el
  // backend, así que un fallo aquí simplemente no actualiza nada.
  refreshAirtableKpi(): Observable<AirtableKpi | null> {
    return this.http.jsonp<AirtableKpi>(`${this.api}?route=refresh-airtable-kpi`, 'callback').pipe(
      catchError(() => of(null))
    );
  }
}
