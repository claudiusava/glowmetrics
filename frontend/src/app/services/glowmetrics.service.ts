import { Injectable } from '@angular/core';
import { Observable, catchError, finalize, of, shareReplay, timeout } from 'rxjs';
import { hedgedRequest } from './hedged-request';
import { jsonpRequest } from './jsonp-request';
import { environment } from '../../environments/environment';
import { ReviewsResponse, MonthlyGoal, AirtableKpi, MonthlyHistoryEntry, Note, AddNoteResult, BootstrapResponse, WaitItem, WaitlistResult } from '../models/review.model';

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
//
// Las lecturas esperan mucho más que las escrituras: Apps Script en frío o
// con varias peticiones a la vez tarda a menudo 20-50 s, y con un timeout de
// 15 s la app tiraba una respuesta que acababa llegando bien y volvía a
// preguntar, empeorando justo la saturación que causaba la espera.
const READ_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 45_000;
const HEDGE_AT_MS = [6_000, 14_000];

@Injectable({ providedIn: 'root' })
export class GlowmetricsService {
  private api = environment.apiUrl;

  // Lecturas en curso por ruta: si alguien pide lo mismo mientras la primera
  // petición sigue en el aire (sondeo + volver de otra pestaña + carga
  // inicial), comparte esa respuesta en vez de lanzar otra al servidor.
  private inflight = new Map<string, Observable<unknown>>();

  // `hedge`: si no hay respuesta a los 6 s (y de nuevo a los 14 s) se lanza
  // otra petición igual en paralelo y gana la primera que llegue. Apps Script
  // tiene picos de 8-70 s que no dependen del código; cada petición cae en uno
  // de forma independiente. Solo para lecturas inofensivas de repetir.
  private read<T>(route: string, hedge = true): Observable<T | null> {
    const existing = this.inflight.get(route);
    if (existing) return existing as Observable<T | null>;

    const url = `${this.api}?route=${route}`;
    const request$ = hedgedRequest<T>(() => jsonpRequest<T>(url), {
      hedgeAtMs: hedge ? HEDGE_AT_MS : [],
      timeoutMs: READ_TIMEOUT_MS,
    }).pipe(
      // Solo se retira a sí misma: otra petición más nueva de la misma ruta
      // (p. ej. tras guardar una nota) puede haber ocupado ya su sitio.
      finalize(() => { if (this.inflight.get(route) === request$) this.inflight.delete(route); }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.inflight.set(route, request$);
    return request$;
  }

  private write<T>(url: string): Observable<T | null> {
    return jsonpRequest<T>(url).pipe(
      timeout(WRITE_TIMEOUT_MS),
      catchError(() => of(null))
    );
  }

  // Todo lo que necesita la pantalla al abrir en UNA petición (antes 5-6).
  bootstrap(): Observable<BootstrapResponse | null> {
    return this.read<BootstrapResponse>('bootstrap');
  }

  // Sin carrera: en una primera carga initialize puede llegar a SerpApi y no
  // queremos que dos copias de la petición se solapen.
  initialize(): Observable<ReviewsResponse | null> {
    return this.read<ReviewsResponse>('initialize', false);
  }

  checkForUpdates(): Observable<ReviewsResponse | null> {
    return this.read<ReviewsResponse>('updates');
  }

  getMonthlyGoal(): Observable<MonthlyGoal | null> {
    return this.read<MonthlyGoal>('monthly-goal');
  }

  getSalesTips(): Observable<string[] | null> {
    return this.read<string[]>('sales-tips');
  }

  getAirtableKpi(): Observable<AirtableKpi | null> {
    return this.read<AirtableKpi>('airtable-kpi');
  }

  // Refresco manual bajo demanda (código secreto). Cooldown real en el
  // backend, así que un fallo aquí simplemente no actualiza nada.
  refreshAirtableKpi(): Observable<AirtableKpi | null> {
    return this.write<AirtableKpi>(`${this.api}?route=refresh-airtable-kpi`);
  }

  getMonthlyHistory(): Observable<MonthlyHistoryEntry[] | null> {
    return this.read<MonthlyHistoryEntry[]>('monthly-history');
  }

  // Cuaderno de notas compartido: sin autor (varias personas comparten el
  // mismo ordenador en el centro, pedir nombre no tiene sentido aquí).
  getNotes(): Observable<Note[] | null> {
    return this.read<Note[]>('notes-list');
  }

  // Tras una escritura de notas, una lectura de notas que ya estuviera en
  // el aire se pidió ANTES del cambio y podría traer la lista vieja: la
  // soltamos para que la siguiente lectura sea una petición nueva.
  private writeNote<T>(url: string): Observable<T | null> {
    this.inflight.delete('notes-list');
    return this.write<T>(url);
  }

  addNote(text: string, clientId: string): Observable<AddNoteResult | null> {
    return this.writeNote<AddNoteResult>(
      `${this.api}?route=notes-add&text=${encodeURIComponent(text)}&clientId=${encodeURIComponent(clientId)}`
    );
  }

  deleteNote(id: string): Observable<AddNoteResult | null> {
    return this.writeNote<AddNoteResult>(`${this.api}?route=notes-delete&id=${encodeURIComponent(id)}`);
  }

  // ---- Lista de espera de clientas ----
  // Mismas reglas que las notas: se lee con respaldo (carrera) y, tras
  // escribir, se descarta la lectura compartida en curso (se pidió antes del
  // cambio y podría traer la lista vieja).
  getWaitlist(): Observable<WaitItem[] | null> {
    return this.read<WaitItem[]>('waitlist-list');
  }

  private writeWait<T>(url: string): Observable<T | null> {
    this.inflight.delete('waitlist-list');
    return this.write<T>(url);
  }

  addWaitItem(item: { name: string; zones: string; days: string; parts: string; detail: string }, clientId: string): Observable<WaitlistResult | null> {
    const q = (k: string, v: string) => `&${k}=${encodeURIComponent(v)}`;
    return this.writeWait<WaitlistResult>(
      `${this.api}?route=waitlist-add` + q('name', item.name) + q('zones', item.zones) + q('days', item.days) +
      q('parts', item.parts) + q('detail', item.detail) + q('clientId', clientId)
    );
  }

  // Solo se envían los campos que cambian.
  updateWaitItem(id: string, patch: Partial<Pick<WaitItem, 'name' | 'zones' | 'days' | 'parts' | 'detail' | 'status'>>): Observable<WaitlistResult | null> {
    let url = `${this.api}?route=waitlist-update&id=${encodeURIComponent(id)}`;
    for (const [k, v] of Object.entries(patch)) url += `&${k}=${encodeURIComponent(String(v ?? ''))}`;
    return this.writeWait<WaitlistResult>(url);
  }

  deleteWaitItem(id: string): Observable<WaitlistResult | null> {
    return this.writeWait<WaitlistResult>(`${this.api}?route=waitlist-delete&id=${encodeURIComponent(id)}`);
  }

  editNote(id: string, text: string): Observable<AddNoteResult | null> {
    return this.writeNote<AddNoteResult>(
      `${this.api}?route=notes-edit&id=${encodeURIComponent(id)}&text=${encodeURIComponent(text)}`
    );
  }
}
