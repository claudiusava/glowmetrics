import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { GlowmetricsService } from './services/glowmetrics.service';
import { ConfettiService } from './services/confetti.service';
import { SnapshotCacheService } from './services/snapshot-cache.service';
import { KpiCardComponent } from './components/kpi-card/kpi-card.component';
import { MonthlyGoalComponent } from './components/monthly-goal/monthly-goal.component';
import { MonthlyHistoryComponent } from './components/monthly-history/monthly-history.component';
import { NotesBoardComponent } from './components/notes-board/notes-board.component';
import { ReviewsFeedComponent } from './components/reviews-feed/reviews-feed.component';
import { Review, ReviewsResponse, MonthlyGoal, AirtableKpi, MonthlyHistoryEntry, Note } from './models/review.model';

// Esperas entre reintentos tras un fallo REAL (error o timeout de 60 s), cada
// vez más largas: reintentar deprisa solo satura más a un backend que ya va
// lento. Pasados todos los intentos, el sondeo periódico o volver a la
// pestaña vuelven a probar.
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000];
const INITIAL_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

// Si la página no termina de cargar en este tiempo (p. ej. la fuente va
// lenta), lanzamos las llamadas igualmente.
const PAGE_LOAD_MAX_WAIT_MS = 2_500;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const POLL_MS = 60_000;
const MONTHLY_GOAL_POLL_MS = 60 * 60 * 1_000; // cada hora
const MONTHLY_HISTORY_POLL_MS = 60 * 60 * 1_000; // cada hora
const NOTES_POLL_MS = 60_000;
const TIP_ROTATE_MS = 60_000;

// El cuaderno es compartido sin autor (varias personas usan el mismo
// ordenador del centro). Guardamos en este navegador el id de la última
// nota vista para saber si hay algo nuevo desde la última vez — es un
// aviso "para mí, en este dispositivo", no un dato que deba coincidir
// entre pantallas.
const NOTES_SEEN_KEY = 'glowmetrics_notes_seen_v1';

// Código secreto: se teclea en cualquier momento (la app no tiene campos de
// texto, así que nadie lo escribe sin querer) para forzar un refresco real
// de Airtable, útil si el trigger de las 13:00/19:00 coincidió con un
// filtro puesto a mano en la tabla. El cooldown real vive en el backend.
const SECRET_REFRESH_CODE = 'airtable';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, KpiCardComponent, MonthlyGoalComponent, MonthlyHistoryComponent, NotesBoardComponent, ReviewsFeedComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('bottomHeader') bottomHeader!: ElementRef<HTMLElement>;

  // State
  kpi: AirtableKpi | null = null;
  monthlyGoal: MonthlyGoal | null = null;
  reviews: Review[] = [];
  totalCount = 0;
  loadingReviews = true;
  currentTip = 'Cargando consejo…';
  refreshToast: string | null = null;
  newReviewsCount = 0;
  monthlyHistory: MonthlyHistoryEntry[] = [];
  notes: Note[] = [];
  notesModalOpen = false;
  hasUnreadNotes = false;
  addingNote = false;
  deletingNote = false;
  editingNote = false;
  editNoteError: string | null = null;
  addNoteError: string | null = null;

  // Varias fuentes piden notas a la vez (sondeo, abrir el modal, volver de
  // otra pestaña, y las propias respuestas de añadir/borrar/editar). Si dos
  // peticiones se cruzan y la más lenta llega DESPUÉS de una más reciente,
  // pisaba el resultado bueno con uno viejo (una nota recién añadida podía
  // "desaparecer" unos segundos). Este contador asegura que solo se aplica
  // la respuesta de la petición más reciente, gane quien gane la carrera.
  private notesSeq = 0;

  // Justo después de escribir (añadir/editar/borrar), el sondeo automático
  // de notas puede lanzar su propia lectura mientras esa escritura aún no
  // ha terminado de confirmarse en el backend (las rutas de notas no usan
  // lock compartido, a propósito, para no ralentizar el resto de la app).
  // Si esa lectura "vieja" resuelve después de la respuesta de la propia
  // escritura, gana la carrera por dispatch-order y pisa el resultado bueno
  // con uno desactualizado — se autocorregía en el siguiente sondeo, pero
  // tardaba hasta 60s. Pausamos el sondeo pasivo un rato tras cada escritura
  // para no competir contra ella (las lecturas explícitas, como abrir el
  // cuaderno, no se ven afectadas).
  private lastNotesWriteAt = 0;
  private readonly NOTES_WRITE_COOLDOWN_MS = 5000;

  private tips: string[] = [];
  private tipTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private secretBuffer = '';
  private subs = new Subscription();
  private retryAttempts = new Map<string, number>();
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private svc: GlowmetricsService,
    private confetti: ConfettiService,
    private cache: SnapshotCacheService,
  ) {}

  ngOnInit(): void {
    // Pintamos al instante lo último que vimos en este navegador y luego
    // refrescamos en segundo plano. Las llamadas a Apps Script esperan a que
    // la página termine de cargar: mientras un script JSONP sigue pendiente
    // el navegador mantiene la pestaña "cargando" (llegó a 116 s con el
    // backend lento).
    this.restoreFromCache();
    this.afterPageLoad(() => this.loadEverything());
    this.startPolling();

    // Monthly goal cada hora
    this.subs.add(
      interval(MONTHLY_GOAL_POLL_MS).subscribe(() => this.loadMonthlyGoal())
    );
    this.subs.add(
      interval(MONTHLY_HISTORY_POLL_MS).subscribe(() => this.loadMonthlyHistory())
    );
    this.subs.add(
      interval(NOTES_POLL_MS).subscribe(() => { if (!document.hidden) this.pollNotesIfIdle(); })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.tipTimer) clearInterval(this.tipTimer);
    this.retryTimers.forEach(t => clearTimeout(t));
    this.retryTimers.clear();
    this.confetti.stopLoop();
  }

  private afterPageLoad(fn: () => void): void {
    if (document.readyState === 'complete') {
      fn();
      return;
    }
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    window.addEventListener('load', run, { once: true });
    setTimeout(run, PAGE_LOAD_MAX_WAIT_MS);
  }

  private loadEverything(): void {
    this.loadInitial();
    this.loadAirtableKpi();
    this.loadMonthlyGoal();
    this.loadMonthlyHistory();
    this.loadSalesTips();
    this.loadNotes();
  }

  private restoreFromCache(): void {
    const reviews = this.cache.get<ReviewsResponse>('reviews');
    if (reviews && Array.isArray(reviews.reviews) && reviews.reviews.length) {
      this.totalCount = Number(reviews.totalCount) || 0;
      this.reviews = reviews.reviews;
      this.newReviewsCount = reviews.newReviewsCount || 0;
      this.loadingReviews = false;
    }

    const kpi = this.cache.get<AirtableKpi>('kpi');
    if (kpi && typeof kpi.pct === 'number') this.kpi = kpi;

    // Solo si es del mes en curso: un objetivo de otro mes mostraría un
    // conteo equivocado (y podría disparar el confeti sin motivo).
    const goal = this.cache.get<MonthlyGoal>('goal');
    if (goal && goal.monthKey === currentMonthKey()) this.monthlyGoal = goal;

    const history = this.cache.get<MonthlyHistoryEntry[]>('history');
    if (Array.isArray(history)) this.monthlyHistory = history;

    const tips = this.cache.get<string[]>('tips');
    if (Array.isArray(tips) && tips.length) {
      this.tips = tips;
      this.showRandomTip();
    }
  }

  private persistReviews(): void {
    this.cache.set('reviews', {
      totalCount: this.totalCount,
      reviews: this.reviews,
      newReviewsCount: this.newReviewsCount,
    });
  }

  private retryLater(key: string, fn: () => void, delays: number[] = RETRY_DELAYS_MS): void {
    const attempt = this.retryAttempts.get(key) ?? 0;
    if (attempt >= delays.length) return;
    this.retryAttempts.set(key, attempt + 1);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (!document.hidden) fn();
    }, delays[attempt]);
    this.retryTimers.add(timer);
  }

  private retryDone(key: string): void {
    this.retryAttempts.delete(key);
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) return;
    this.retryAttempts.clear();
    // Escalonadas para no golpear el mismo lock del backend con 5
    // peticiones a la vez justo al recuperar el foco de la pestaña.
    this.checkUpdates();
    setTimeout(() => this.loadMonthlyGoal(), 150);
    setTimeout(() => this.loadMonthlyHistory(), 300);
    setTimeout(() => this.loadAirtableKpi(), 450);
    setTimeout(() => this.loadSalesTips(), 600);
    setTimeout(() => this.pollNotesIfIdle(), 750);
  }

  private pollNotesIfIdle(): void {
    if (Date.now() - this.lastNotesWriteAt < this.NOTES_WRITE_COOLDOWN_MS) return;
    this.loadNotes();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.key.length !== 1 || !/[a-z]/i.test(ev.key)) return;
    this.secretBuffer = (this.secretBuffer + ev.key.toLowerCase()).slice(-SECRET_REFRESH_CODE.length);
    if (this.secretBuffer === SECRET_REFRESH_CODE) {
      this.secretBuffer = '';
      this.triggerManualAirtableRefresh();
    }
  }

  private triggerManualAirtableRefresh(): void {
    this.showRefreshToast('Actualizando Airtable…', 8000);
    this.subs.add(
      this.svc.refreshAirtableKpi().subscribe(res => {
        if (!res) {
          this.showRefreshToast('Error al actualizar Airtable');
          return;
        }
        this.kpi = res;
        this.showRefreshToast(
          res.refreshed ? 'Airtable actualizado ✓' : 'Ya se actualizó hace poco, espera unos minutos'
        );
      })
    );
  }

  private showRefreshToast(msg: string, durationMs = 2500): void {
    this.refreshToast = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.refreshToast = null), durationMs);
  }

  private loadInitial(): void {
    this.subs.add(
      this.svc.initialize().subscribe(res => {
        if (!res) {
          // Primer arranque fallido: reintenta (cada vez más despacio) en
          // vez de quedarse en blanco.
          this.retryLater('initialize', () => this.loadInitial(), INITIAL_RETRY_DELAYS_MS);
          return;
        }
        this.retryDone('initialize');
        this.totalCount = res.totalCount;
        this.reviews = res.reviews;
        this.loadingReviews = false;
        this.newReviewsCount = res.newReviewsCount || 0;
        this.persistReviews();
        this.loadMonthlyGoal();
      })
    );
  }

  private checkUpdates(): void {
    if (document.hidden) return;
    this.subs.add(
      this.svc.checkForUpdates().subscribe(res => {
        if (!res) return;
        this.totalCount = res.totalCount;
        this.newReviewsCount = res.newReviewsCount || 0;
        if (res.updated || res.reviews.length !== this.reviews.length) {
          this.reviews = res.reviews;
          this.loadingReviews = false;
          this.persistReviews();
        }
        if (res.updated) this.loadMonthlyGoal();
      })
    );
  }

  private startPolling(): void {
    this.subs.add(
      interval(POLL_MS).pipe(
        switchMap(() => this.svc.checkForUpdates())
      ).subscribe(res => {
        if (document.hidden || !res) return;
        this.totalCount = res.totalCount;
        this.newReviewsCount = res.newReviewsCount || 0;
        if (res.updated || res.reviews.length !== this.reviews.length) {
          this.reviews = res.reviews;
          this.loadingReviews = false;
          this.persistReviews();
          if (res.updated) this.loadMonthlyGoal();
        }
      })
    );
  }

  private loadAirtableKpi(): void {
    this.subs.add(
      // Si falla, no pisamos el KPI ya mostrado con el placeholder de fallo.
      this.svc.getAirtableKpi().subscribe(res => {
        if (!res) {
          this.retryLater('kpi', () => this.loadAirtableKpi());
          return;
        }
        this.retryDone('kpi');
        this.kpi = res;
        this.cache.set('kpi', res);
      })
    );
  }

  private loadMonthlyGoal(): void {
    this.subs.add(
      this.svc.getMonthlyGoal().subscribe(res => {
        if (!res) {
          this.retryLater('goal', () => this.loadMonthlyGoal());
          return;
        }
        this.retryDone('goal');
        this.monthlyGoal = res;
        this.cache.set('goal', res);
      })
    );
  }

  private loadMonthlyHistory(): void {
    this.subs.add(
      this.svc.getMonthlyHistory().subscribe(res => {
        if (!res) {
          this.retryLater('history', () => this.loadMonthlyHistory());
          return;
        }
        this.retryDone('history');
        this.monthlyHistory = res;
        this.cache.set('history', res);
      })
    );
  }

  private loadNotes(): void {
    const seq = ++this.notesSeq;
    this.subs.add(
      this.svc.getNotes().subscribe(res => {
        if (!res || seq !== this.notesSeq) return; // superada por otra más reciente
        this.notes = res;
        this.refreshUnreadFlag();
      })
    );
  }

  private refreshUnreadFlag(): void {
    const latestId = this.notes.length ? this.notes[0].id : null;
    let seen: string | null = null;
    try { seen = localStorage.getItem(NOTES_SEEN_KEY); } catch { /* ignorar */ }
    this.hasUnreadNotes = !!latestId && latestId !== seen;
  }

  private markNotesAsSeen(): void {
    const latestId = this.notes.length ? this.notes[0].id : '';
    try { localStorage.setItem(NOTES_SEEN_KEY, latestId); } catch { /* ignorar */ }
    this.hasUnreadNotes = false;
  }

  toggleNotesModal(): void {
    this.notesModalOpen = !this.notesModalOpen;
    if (this.notesModalOpen) {
      this.markNotesAsSeen();
      this.loadNotes();
    }
  }

  closeNotesModal(): void {
    this.notesModalOpen = false;
  }

  onAddNote(draft: { text: string; clientId: string }): void {
    // No dejamos que se lance una segunda petición mientras la primera
    // sigue en el aire (evita más carreras de las que ya cubre notesSeq).
    if (this.addingNote) return;
    this.addingNote = true;
    this.addNoteError = null;
    const seq = ++this.notesSeq;
    this.subs.add(
      this.svc.addNote(draft.text, draft.clientId).subscribe(res => {
        this.addingNote = false;
        if (res && res.notes && seq === this.notesSeq) {
          this.notes = res.notes;
          this.lastNotesWriteAt = Date.now();
          this.markNotesAsSeen(); // lo acabamos de escribir, no es "sin leer"
          if (res.error) this.addNoteError = res.error;
        } else {
          // Sin respuesta válida: no sabemos si llegó a guardarse, así que
          // no perdemos el texto — "Reintentar" reenvía el mismo clientId,
          // que el backend deduplica si el intento anterior sí se guardó.
          this.addNoteError = 'No se pudo confirmar el guardado. Inténtalo de nuevo.';
        }
      })
    );
  }

  onEditNote(edit: { id: string; text: string }): void {
    if (this.editingNote) return;
    this.editingNote = true;
    this.editNoteError = null;
    const seq = ++this.notesSeq;
    this.subs.add(
      this.svc.editNote(edit.id, edit.text).subscribe(res => {
        this.editingNote = false;
        if (res && res.notes && seq === this.notesSeq) {
          this.notes = res.notes;
          this.lastNotesWriteAt = Date.now();
          this.markNotesAsSeen();
          if (res.error) this.editNoteError = res.error;
        } else {
          // Sin respuesta válida (timeout, red, o una escritura más
          // reciente ganó la carrera): no sabemos si se guardó, así que no
          // tocamos this.notes y dejamos el texto editado listo para
          // reintentar en vez de darlo por perdido en silencio.
          this.editNoteError = 'No se pudo confirmar el guardado. Inténtalo de nuevo.';
        }
      })
    );
  }

  onDeleteNote(id: string): void {
    if (this.deletingNote) return;
    this.deletingNote = true;
    const seq = ++this.notesSeq;
    this.subs.add(
      this.svc.deleteNote(id).subscribe(res => {
        this.deletingNote = false;
        if (res && res.notes && seq === this.notesSeq) {
          this.notes = res.notes;
          this.lastNotesWriteAt = Date.now();
          this.markNotesAsSeen();
        }
      })
    );
  }

  private loadSalesTips(): void {
    if (document.hidden) return;
    this.subs.add(
      this.svc.getSalesTips().subscribe(tips => {
        if (!tips) {
          // fallo transitorio: no tocamos el consejo actual
          this.retryLater('tips', () => this.loadSalesTips());
          return;
        }
        this.retryDone('tips');
        if (tips.length) {
          // Si ya se muestra uno (copia guardada), no lo cambiamos de golpe.
          const alreadyShowing = this.tips.length > 0;
          this.tips = tips;
          this.cache.set('tips', tips);
          if (!alreadyShowing) this.showRandomTip();
          if (this.tipTimer) clearInterval(this.tipTimer);
          this.tipTimer = setInterval(() => {
            if (!document.hidden) this.showRandomTip();
          }, TIP_ROTATE_MS);
        } else {
          this.currentTip = 'Sin consejos disponibles.';
        }
      })
    );
  }

  get reviewsSubtitle(): string {
    if (this.loadingReviews) return 'Cargando…';
    return `Mostrando ${this.reviews.length} (de ${this.totalCount} en total)`;
  }

  private showRandomTip(): void {
    if (!this.tips.length) return;
    this.currentTip = this.tips[Math.floor(Math.random() * this.tips.length)];
  }

  onGoalCompleted(): void {
    const el = this.bottomHeader?.nativeElement;
    if (el) this.confetti.startLoop(el);
  }
}
