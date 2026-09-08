import { Component, Input, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MonthlyGoal } from '../../models/review.model';

@Component({
  selector: 'app-monthly-goal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './monthly-goal.component.html',
  styleUrls: ['./monthly-goal.component.scss'],
})
export class MonthlyGoalComponent implements OnChanges {
  @Input() data: MonthlyGoal | null = null;
  @Output() goalCompleted = new EventEmitter<void>();

  fillPct = 0;
  countLabel = '0/20';
  pctLabel = '0%';
  isCompleted = false;
  private prevCompleted = false;
  private prevMonthKey = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.data) return;

    const { count, goal, monthKey } = this.data;

    // Reset si cambia el mes
    if (monthKey !== this.prevMonthKey) {
      this.prevMonthKey = monthKey;
      this.prevCompleted = false;
    }

    const pct = Math.max(0, Math.min(100, Math.round((count / goal) * 100)));
    this.fillPct = pct;
    this.countLabel = `🎯 Objetivo de reseñas mensual: ${count}/${goal}`;
    this.pctLabel = `${pct}%`;
    this.isCompleted = count >= goal;

    if (this.isCompleted && !this.prevCompleted) {
      this.goalCompleted.emit();
    }
    this.prevCompleted = this.isCompleted;
  }
}
