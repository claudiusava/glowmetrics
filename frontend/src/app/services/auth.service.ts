import { Injectable } from '@angular/core';

const STORAGE_KEY = 'glowmetrics_access_key_v1';

/**
 * Clave de acceso de la app. Se pide una sola vez en cada dispositivo y se recuerda en el navegador
 * (no en el código: el repositorio es público). Si el servidor dice "unauthorized" —porque este
 * dispositivo aún no la tiene, o porque se cambió— se muestra la pantalla de la clave.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** La pantalla de la clave está puesta (el servidor rechazó la petición). */
  locked = false;
  /** La clave que se envía con cada petición ('' si este dispositivo aún no la tiene). */
  key = '';

  constructor() {
    this.key = this.readStored();
  }

  /** El servidor rechazó una petición: se enseña la pantalla de la clave y se olvida la guardada (ya no vale). */
  lock(): void {
    if (this.locked) return;
    this.locked = true;
    if (this.key) { this.key = ''; this.store(''); }
    // La pantalla de carga de index.html se quedaría tapando todo esperando unos datos que no llegarán.
    document.getElementById('splash')?.remove();
  }

  /** La clave tecleada ya está comprobada por el servidor: se guarda para siempre en este dispositivo. */
  unlock(key: string): void {
    this.key = key;
    this.store(key);
    this.locked = false;
  }

  private readStored(): string {
    try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
  }

  private store(key: string): void {
    try {
      if (key) localStorage.setItem(STORAGE_KEY, key); else localStorage.removeItem(STORAGE_KEY);
    } catch { /* sin almacenamiento (ventana privada…): se pedirá de nuevo al recargar */ }
  }
}
