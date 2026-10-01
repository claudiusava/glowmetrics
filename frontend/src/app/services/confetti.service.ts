import { Injectable, NgZone } from '@angular/core';

// Duración total del "modo celebración" en bucle tras cumplir el objetivo
// del mes. Antes se quedaba lanzando confeti cada 2s de forma indefinida
// mientras el objetivo siguiera cumplido (podían ser semanas) — con una
// ráfaga inicial ya es suficiente fiesta; el resto del mes no hace falta
// seguir animando nada de fondo.
const CONFETTI_LOOP_MS = 20_000;

@Injectable({ providedIn: 'root' })
export class ConfettiService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private zone: NgZone) {}

  launch(overEl: HTMLElement, count = 36): void {
    // Todo el trabajo de requestAnimationFrame ocurre fuera de la zona de
    // Angular: si no, zone.js dispara una detección de cambios completa de
    // toda la app en CADA frame de CADA partícula (hasta ~60 veces/seg por
    // partícula), que es carísimo y no aporta nada visualmente.
    this.zone.runOutsideAngular(() => this.launchOutsideZone(overEl, count));
  }

  private launchOutsideZone(overEl: HTMLElement, count = 36): void {
    const rect = overEl.getBoundingClientRect();
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;';
    document.body.appendChild(stage);

    const colors = ['#60a5fa', '#34d399', '#10b981', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6'];

    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.style.cssText = `position:absolute;width:8px;height:12px;border-radius:2px;opacity:.95;will-change:transform,opacity;background:${colors[Math.floor(Math.random() * colors.length)]};`;

      const startX = rect.left + Math.random() * rect.width;
      const startY = rect.top + rect.height / 2;
      const drift = Math.random() * 160 - 80;
      const fall = 140 + Math.random() * 120;
      const rot = 180 + Math.random() * 360;
      const dur = 900 + Math.random() * 500;
      const t0 = performance.now();

      p.style.left = '0px';
      p.style.top = '0px';

      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        p.style.transform = `translate(${startX + drift * e}px, ${startY + fall * e}px) rotate(${rot * e}deg)`;
        p.style.opacity = String(0.95 - t * 0.35);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      stage.appendChild(p);
    }

    setTimeout(() => stage.remove(), 1800);
  }

  startLoop(overEl: HTMLElement): void {
    if (this.timer) return;
    this.launch(overEl, 64);

    // El propio setInterval también fuera de la zona: si no, cada tick
    // (cada 2s) sí dispararía una detección de cambios completa aunque el
    // trabajo real de las partículas ya esté fuera.
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => this.launchOutsideZone(overEl, 24), 2000);
    });

    this.stopTimer = setTimeout(() => this.stopLoop(), CONFETTI_LOOP_MS);
  }

  stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }
}
