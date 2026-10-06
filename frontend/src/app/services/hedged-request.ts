import { Observable, Subscription } from 'rxjs';

export interface HedgeOptions {
  /** Instantes (ms desde el inicio) en los que se lanza una petición extra si
   * todavía no ha llegado ninguna respuesta. */
  hedgeAtMs: number[];
  /** Tiempo máximo total antes de rendirse y devolver null. */
  timeoutMs: number;
}

/**
 * Lanza `attempt()` y, si en `hedgeAtMs` aún no hay respuesta, lanza otra
 * igual EN PARALELO, quedándose con la primera que responda. Apps Script tiene
 * picos de 8-70 s que no dependen del código ni de la carga, y cada petición
 * cae en uno de forma independiente: con dos o tres en carrera, la
 * probabilidad de que TODAS se atasquen baja mucho.
 *
 * - Solo para lecturas (varias copias de una petición no deben tener efectos).
 * - Un fallo (no un pico) lanza la siguiente al instante, sin esperar.
 * - Devuelve null si todas fallan o se agota `timeoutMs`; nunca lanza error.
 * - Al terminar (o al desuscribirse) cancela timers y peticiones pendientes.
 */
export function hedgedRequest<T>(attempt: () => Observable<T>, opts: HedgeOptions): Observable<T | null> {
  return new Observable<T | null>(subscriber => {
    const maxAttempts = opts.hedgeAtMs.length + 1;
    let launched = 0;
    let failed = 0;
    let finished = false;
    const running: Subscription[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = (value: T | null) => {
      if (finished) return;
      finished = true;
      subscriber.next(value);
      subscriber.complete();
    };

    const launch = () => {
      if (finished || launched >= maxAttempts) return;
      launched++;
      let settled = false;

      const markFailed = () => {
        if (settled || finished) return;
        settled = true;
        failed++;
        // Si no queda ninguna petición en el aire, no esperamos al siguiente
        // instante programado: lanzamos ya la siguiente (o nos rendimos).
        if (failed >= launched) {
          if (launched >= maxAttempts) finish(null);
          else launch();
        }
      };

      running.push(attempt().subscribe({
        next: value => { settled = true; finish(value); },
        error: markFailed,
        complete: markFailed, // terminó sin dar nada: cuenta como fallo
      }));
    };

    opts.hedgeAtMs.forEach(ms => timers.push(setTimeout(launch, ms)));
    timers.push(setTimeout(() => finish(null), opts.timeoutMs));
    launch();

    return () => {
      finished = true;
      timers.forEach(clearTimeout);
      running.forEach(s => s.unsubscribe());
    };
  });
}
