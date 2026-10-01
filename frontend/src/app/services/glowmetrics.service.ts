import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { ReviewsResponse, MonthlyGoal, AirtableKpi, MonthlyHistoryEntry, Note, AddNoteResult } from '../models/review.model';

// Apps Script (ContentService) no manda cabeceras CORS, así que consumimos
// su API vía JSONP en vez de XHR/fetch normal.
//
// Todos los métodos devuelven `null` cuando la petición falla (en vez de un
// objeto "en cero" como antes) para que el componente pueda distinguir un
// fallo transitorio de un dato real y conservar el último dato bueno en
// pantalla en vez de sobrescribirlo con ceros falsos.
//
// JSONP no tiene timeout propio: si el script nunca llega a cargar, la
// petición se queda colgada para siempre (nunca resuelve ni falla). Por
// eso todas las llamadas llevan un timeout explícito — si no, un fallo de
// red silencioso podía dejar botones bloqueados en "Guardando…" sin fin.
const REQUEST_TIMEOUT_MS = 15000;

@Injectable({ providedIn: 'root' })
export class GlowmetricsService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  initialize(): Observable<ReviewsResponse | null> {
    return this.http.jsonp<ReviewsResponse>(`${this.api}?route=initialize`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  checkForUpdates(): Observable<ReviewsResponse | null> {
    return this.http.jsonp<ReviewsResponse>(`${this.api}?route=updates`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  getMonthlyGoal(): Observable<MonthlyGoal | null> {
    return this.http.jsonp<MonthlyGoal>(`${this.api}?route=monthly-goal`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  getSalesTips(): Observable<string[] | null> {
    return this.http.jsonp<string[]>(`${this.api}?route=sales-tips`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  getAirtableKpi(): Observable<AirtableKpi | null> {
    return this.http.jsonp<AirtableKpi>(`${this.api}?route=airtable-kpi`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  // Refresco manual bajo demanda (código secreto). Cooldown real en el
  // backend, así que un fallo aquí simplemente no actualiza nada.
  refreshAirtableKpi(): Observable<AirtableKpi | null> {
    return this.http.jsonp<AirtableKpi>(`${this.api}?route=refresh-airtable-kpi`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  getMonthlyHistory(): Observable<MonthlyHistoryEntry[] | null> {
    return this.http.jsonp<MonthlyHistoryEntry[]>(`${this.api}?route=monthly-history`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  // Cuaderno de notas compartido: sin autor (varias personas comparten el
  // mismo ordenador en el centro, pedir nombre no tiene sentido aquí).
  getNotes(): Observable<Note[] | null> {
    return this.http.jsonp<Note[]>(`${this.api}?route=notes-list`, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  addNote(text: string, clientId: string): Observable<AddNoteResult | null> {
    const url = `${this.api}?route=notes-add&text=${encodeURIComponent(text)}&clientId=${encodeURIComponent(clientId)}`;
    return this.http.jsonp<AddNoteResult>(url, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  deleteNote(id: string): Observable<AddNoteResult | null> {
    const url = `${this.api}?route=notes-delete&id=${encodeURIComponent(id)}`;
    return this.http.jsonp<AddNoteResult>(url, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  editNote(id: string, text: string): Observable<AddNoteResult | null> {
    const url = `${this.api}?route=notes-edit&id=${encodeURIComponent(id)}&text=${encodeURIComponent(text)}`;
    return this.http.jsonp<AddNoteResult>(url, 'callback').pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }
}
