import { Injectable } from '@angular/core';

// Última copia buena de cada dato, guardada en este navegador, para pintar
// algo al instante al abrir la web mientras Apps Script (que puede tardar
// decenas de segundos en frío) contesta con lo nuevo. Si cambia la forma de
// los datos, subir la versión del prefijo para descartar copias antiguas.
// OJO: index.html lee `${PREFIX}reviews` para decidir si muestra la pantalla de
// carga; si cambia el prefijo hay que cambiarlo también allí.
const PREFIX = 'glowmetrics_snap_v1_';

@Injectable({ providedIn: 'root' })
export class SnapshotCacheService {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch { /* sin localStorage o lleno: simplemente no hay copia */ }
  }
}
