import { Observable } from 'rxjs';

// Apps Script no manda cabeceras CORS, así que se consume por JSONP: se inserta
// un <script> cuya respuesta es `nombreCallback({...})`.
//
// Cargador propio en vez de HttpClient.jsonp porque, al cancelar una petición
// (la perdedora de una carrera, o una que da timeout), Angular BORRA su función
// de respuesta; si el script llega después, el navegador lanza
// "ReferenceError: ng_jsonp_callback_N is not defined" en consola. Aquí, al
// cancelar, la función se deja como no-op un buen rato para absorber esa
// respuesta tardía sin ruido, y solo entonces se elimina.
const LATE_RESPONSE_GRACE_MS = 3 * 60_000;

let counter = 0;

// Zone.js (de Angular) no envuelve la función global que llama el script
// JSONP al ejecutarse: sin esto, la respuesta se procesa FUERA de la zona de
// Angular, los datos llegan al componente pero la vista no se repinta hasta
// que otra cosa dispara la detección de cambios (un temporizador, el sondeo
// del minuto, mover el ratón). Por eso la respuesta se re-entra en la zona en
// la que se pidió.
declare const Zone: { current: { run<R>(fn: () => R): R } } | undefined;

export function jsonpRequest<T>(url: string): Observable<T> {
  return new Observable<T>(subscriber => {
    const name = `gm_jsonp_${Date.now().toString(36)}_${counter++}`;
    const win = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const zone = typeof Zone !== 'undefined' ? Zone.current : null;
    let settled = false;

    win[name] = (data: T) => {
      const deliver = () => {
        if (settled) return;
        settled = true;
        subscriber.next(data);
        subscriber.complete();
      };
      if (zone) zone.run(deliver); else deliver();
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      subscriber.error(new Error(message));
    };
    script.onerror = () => fail('JSONP: error al cargar el script');
    // El callback se ejecuta durante la carga, antes de 'load': si llegamos
    // aquí sin respuesta, el script se ejecutó pero no llamó a la función.
    script.onload = () => fail('JSONP: el script no llamó al callback');

    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${name}`;
    document.body.appendChild(script);

    return () => {
      settled = true;
      script.onload = null;
      script.onerror = null;
      script.remove();
      win[name] = () => { /* respuesta tardía de una petición ya descartada */ };
      setTimeout(() => { delete win[name]; }, LATE_RESPONSE_GRACE_MS);
    };
  });
}
