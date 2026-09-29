import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { ReviewsResponse, MonthlyGoal, AirtableKpi, MonthlyHistoryEntry } from '../models/review.model';

// Apps Script (ContentService) no manda cabeceras CORS, así que consumimos
// su API vía JSONP en vez de XHR/fetch normal.
//
// Todos los métodos devuelven `null` cuando la petición falla (en vez de un
// objeto "en cero" como antes) para que el componente pueda distinguir un
// fallo transitorio de un dato real y conservar el último dato bueno en
// pantalla en vez de sobrescribirlo con ceros falsos.
@Injectable({ providedIn: 'root' })
export class GlowmetricsService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  initialize(): Observable<ReviewsResponse | null> {
    return this.http.jsonp<ReviewsResponse>(`${this.api}?route=initialize`, 'callback').pipe(
      catchError(() => of(null))
    );
  }

  checkForUpdates(): Observable<ReviewsResponse | null> {
    return this.http.jsonp<ReviewsResponse>(`${this.api}?route=updates`, 'callback').pipe(
      catchError(() => of(null))
    );
  }

  getMonthlyGoal(): Observable<MonthlyGoal | null> {
    return this.http.jsonp<MonthlyGoal>(`${this.api}?route=monthly-goal`, 'callback').pipe(
      catchError(() => of(null))
    );
  }

  getSalesTips(): Observable<string[] | null> {
    return this.http.jsonp<string[]>(`${this.api}?route=sales-tips`, 'callback').pipe(
      catchError(() => of(null))
    );
  }

  getAirtableKpi(): Observable<AirtableKpi | null> {
    return this.http.jsonp<AirtableKpi>(`${this.api}?route=airtable-kpi`, 'callback').pipe(
      catchError(() => of(null))
    );
  }

  // Refresco manual bajo demanda (código secreto). Cooldown real en el
  // backend, así que un fallo aquí simplemente no actualiza nada.
  refreshAirtableKpi(): Observable<AirtableKpi | null> {
    return this.http.jsonp<AirtableKpi>(`${this.api}?route=refresh-airtable-kpi`, 'callback').pipe(
      catchError(() => of(null))
    );
  }

  getMonthlyHistory(): Observable<MonthlyHistoryEntry[] | null> {
    return this.http.jsonp<MonthlyHistoryEntry[]>(`${this.api}?route=monthly-history`, 'callback').pipe(
      catchError(() => of(null))
    );
  }
}
