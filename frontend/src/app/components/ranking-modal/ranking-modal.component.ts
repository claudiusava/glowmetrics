import { Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RankingBoardComponent } from '../ranking-board/ranking-board.component';
import { lockPage } from '../../utils/page-lock';

// Ventana propia del ranking de reseñas (se abre desde el enlace "Ranking España"
// de la mitad inferior). Mismo comportamiento que el modal de la chincheta: no se
// cierra al pulsar fuera, la página de detrás queda bloqueada y se cierra con la ✕ o Escape.
@Component({
  selector: 'app-ranking-modal',
  standalone: true,
  imports: [CommonModule, RankingBoardComponent],
  templateUrl: './ranking-modal.component.html',
  styleUrls: ['./ranking-modal.component.scss'],
})
export class RankingModalComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Output() closeRequested = new EventEmitter<void>();

  private unlock: (() => void) | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['open']) return;
    if (this.open && !this.unlock) this.unlock = lockPage();
    else if (!this.open) this.release();
  }

  ngOnDestroy(): void {
    this.release();
  }

  private release(): void {
    this.unlock?.();
    this.unlock = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  close(): void {
    this.closeRequested.emit();
  }

  // Rueda y dedo sobre la zona oscura no deben mover nada (iOS ignora overflow:hidden del body).
  blockOutsideScroll(ev: Event): void {
    if (ev.target === ev.currentTarget) ev.preventDefault();
  }
}
