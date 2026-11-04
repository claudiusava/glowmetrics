import { Injectable } from '@angular/core';
import { interval } from 'rxjs';
import { canReload, hasNewVersion, versionFiles, versionKey } from './update-logic';

const CHECK_MS = 10 * 60_000;
const RELOADED_KEY = 'glowmetrics_reloaded_for_v1';
const ASSETS = 'script[src], link[rel="stylesheet"]';

/**
 * Una pestaña que se queda abierta días no se entera de que se ha publicado una versión nueva.
 * Cada 10 minutos (y al volver a ella) se lee la página publicada y se comparan los ficheros con
 * los que tiene cargados; si hay versión nueva y nadie la está usando, se recarga sola.
 * Con la copia guardada en el navegador, la recarga se ve al instante.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private lastActivityAt = Date.now();
  private checking = false;

  constructor() {
    const touch = () => { this.lastActivityAt = Date.now(); };
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      document.addEventListener(ev, touch, { passive: true, capture: true });
    }
    interval(CHECK_MS).subscribe(() => this.check());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.check(); });
  }

  private assetsOf(doc: Document): string[] {
    return versionFiles(Array.from(doc.querySelectorAll(ASSETS))
      .map(el => el.getAttribute('src') ?? el.getAttribute('href') ?? ''));
  }

  private async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const res = await fetch(`${location.origin}${location.pathname}?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = this.assetsOf(new DOMParser().parseFromString(await res.text(), 'text/html'));
      if (!hasNewVersion(this.assetsOf(document), latest)) return;

      const key = versionKey(latest);
      const t = document.activeElement as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (!canReload({
        now: Date.now(), lastActivityAt: this.lastActivityAt, typing,
        alreadyReloadedFor: this.reloadedFor(), latestKey: key,
      })) return;

      try { sessionStorage.setItem(RELOADED_KEY, key); } catch { /* sin sessionStorage: se arriesga a recargar una vez más */ }
      location.reload();
    } catch { /* sin red: se vuelve a intentar en el siguiente turno */ }
    finally { this.checking = false; }
  }

  private reloadedFor(): string | null {
    try { return sessionStorage.getItem(RELOADED_KEY); } catch { return null; }
  }
}
