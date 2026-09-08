import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ConfettiService {
  private timer: ReturnType<typeof setInterval> | null = null;

  launch(overEl: HTMLElement, count = 36): void {
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
    this.timer = setInterval(() => this.launch(overEl, 24), 2000);
  }

  stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
