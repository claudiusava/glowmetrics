import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { GlowmetricsService } from './services/glowmetrics.service';
import { ConfettiService } from './services/confetti.service';
import { KpiCardComponent } from './components/kpi-card/kpi-card.component';
import { MonthlyGoalComponent } from './components/monthly-goal/monthly-goal.component';
import { ReviewsFeedComponent } from './components/reviews-feed/reviews-feed.component';
import { Review, MonthlyGoal, AirtableKpi } from './models/review.model';

const POLL_MS = 60_000;
const MONTHLY_GOAL_POLL_MS = 60 * 60 * 1_000; // cada hora
const TIP_ROTATE_MS = 60_000;

// Código secreto: se teclea en cualquier momento (la app no tiene campos de
// texto, así que nadie lo escribe sin querer) para forzar un refresco real
// de Airtable, útil si el trigger de las 13:00/19:00 coincidió con un
// filtro puesto a mano en la tabla. El cooldown real vive en el backend.
const SECRET_REFRESH_CODE = 'airtable';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, KpiCardComponent, MonthlyGoalComponent, ReviewsFeedComponent],
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

  private tips: string[] = [];
  private tipTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private secretBuffer = '';
  private subs = new Subscription();

  constructor(
    private svc: GlowmetricsService,
    private confetti: ConfettiService,
  ) {}

  ngOnInit(): void {
    this.loadInitial();
    this.startPolling();
    this.loadAirtableKpi();
    this.loadMonthlyGoal();
    this.loadSalesTips();

    // Monthly goal cada hora
    this.subs.add(
      interval(MONTHLY_GOAL_POLL_MS).subscribe(() => this.loadMonthlyGoal())
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.tipTimer) clearInterval(this.tipTimer);
    this.confetti.stopLoop();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (!document.hidden) {
      this.checkUpdates();
      this.loadMonthlyGoal();
      this.loadAirtableKpi();
      this.loadSalesTips();
    }
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
        this.totalCount = res.totalCount;
        this.reviews = res.reviews;
        this.loadingReviews = false;
        this.newReviewsCount = res.newReviewsCount || 0;
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
          if (res.updated) this.loadMonthlyGoal();
        }
      })
    );
  }

  private loadAirtableKpi(): void {
    this.subs.add(
      this.svc.getAirtableKpi().subscribe(res => this.kpi = res)
    );
  }

  private loadMonthlyGoal(): void {
    this.subs.add(
      this.svc.getMonthlyGoal().subscribe(res => this.monthlyGoal = res)
    );
  }

  private loadSalesTips(): void {
    if (document.hidden) return;
    this.subs.add(
      this.svc.getSalesTips().subscribe(tips => {
        if (tips.length) {
          this.tips = tips;
          this.showRandomTip();
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
