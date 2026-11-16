// Cuándo se piden los avisos de las pestañas (limpieza, lista de espera, contactos). Los tres datos solo
// cambian cuando alguien apunta algo (y cada pantalla ya ve al instante lo que apunta ella misma) o al
// pasar la medianoche (eso se recalcula en la propia pantalla, sin red). Por eso basta una sola petición
// cada pocos minutos, no tres cada minuto: con Apps Script, menos peticiones es menos atascos.

/** Cada cuánto se refrescan los avisos con la pantalla a la vista. */
export const FEED_EVERY_MS = 5 * 60_000;
/** Espera tras abrir la web antes de pedirlos (primero va la petición principal de la pantalla de inicio). */
export const FEED_FIRST_DELAY_MS = 5_000;
/** Margen aleatorio para que varias pantallas abiertas a la vez no pidan en el mismo segundo. */
export const FEED_JITTER_MS = 5_000;
/** Al volver a la pestaña solo se pide de nuevo si lo último tiene al menos esta antigüedad. */
export const FEED_MIN_GAP_MS = 60_000;
/** Si una petición falla, un único reintento pasado este tiempo (el siguiente turno normal hace el resto). */
export const FEED_RETRY_MS = 30_000;

/** ¿Hay que volver a pedir los avisos al volver a la pestaña? */
export function dueForRefresh(now: number, lastAt: number, hidden: boolean): boolean {
  return !hidden && now - lastAt >= FEED_MIN_GAP_MS;
}
