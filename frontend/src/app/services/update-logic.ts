// Lógica pura de la recarga automática por versión nueva (sin DOM, para poder probarla en Node).

/** Lo que tiene que haber pasado para recargar sola la página: nadie la toca desde hace un rato. */
export const IDLE_BEFORE_RELOAD_MS = 5 * 60_000;

/**
 * ¿Hay versión nueva? Se comparan los ficheros que carga la página (scripts y hojas de estilo,
 * con el hash en el nombre): si los de ahora son otros, se ha publicado algo. Si no se pudo
 * leer la página nueva (lista vacía) no se concluye nada.
 */
export function hasNewVersion(loaded: string[], latest: string[]): boolean {
  if (!latest.length) return false;
  const a = [...new Set(loaded)].sort().join('|');
  const b = [...new Set(latest)].sort().join('|');
  return a !== b;
}

/** Marca de una versión, para recordar a cuál nos hemos recargado ya. */
export function versionKey(latest: string[]): string {
  return [...new Set(latest)].sort().join('|');
}

export interface ReloadContext {
  now: number;
  lastActivityAt: number;     // última vez que alguien tocó el ratón, el teclado o la pantalla
  typing: boolean;            // el foco está en un campo de texto (puede haber algo a medio escribir)
  alreadyReloadedFor: string | null; // versión a la que ya se recargó (para no entrar en bucle)
  latestKey: string;
}

/** Recargar solo si hay versión nueva, nadie la está usando y no se ha intentado ya con esa versión. */
export function canReload(c: ReloadContext): boolean {
  if (c.typing) return false;
  if (c.alreadyReloadedFor === c.latestKey) return false; // la copia del servidor aún es la vieja: no insistir
  return c.now - c.lastActivityAt >= IDLE_BEFORE_RELOAD_MS;
}

/**
 * De todo lo que la página tiene cargado, solo cuentan los ficheros de la propia web (con el hash en el
 * nombre). Los scripts de otros sitios o con parámetros (las peticiones al servidor, que se añaden y se
 * quitan solas) no son parte de la versión.
 */
export function versionFiles(srcs: string[]): string[] {
  return srcs.filter(s => s && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(s) && !/[?#]/.test(s));
}
