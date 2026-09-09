/*************************
 * tools_backfill.js
 *
 * Herramienta manual de un solo uso: reconstruye el histórico mensual de
 * "objetivo cumplido/no cumplido" de los últimos 12 meses paginando hacia
 * atrás en SerpApi. NO se expone por HTTP (no hay ruta en jsonRoute_) —
 * se ejecuta a mano una vez desde el editor de Apps Script o vía
 * `clasp run backfillMonthlyHistory_`, nunca automáticamente.
 *
 * Tope duro de llamadas (independiente del límite diario normal de
 * SERPAPI_DAILY_LIMIT, porque esto es una operación puntual autorizada
 * explícitamente, no el flujo normal de la app).
 *************************/

function backfillMonthlyHistory_() {
  const MAX_CALLS = 30;
  const MONTHS_BACK = 12;

  const now = new Date();
  const currentMonthKey = monthKeyOf_(now);
  const cutoff = new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK, 1);

  const apiKey = getSerpApiKey_();
  const counts = {}; // monthKey -> nº reseñas
  let callsUsed = 0;
  let token = null;
  let oldestSeen = now;
  let stopReason = 'agotó páginas';

  do {
    const params = {
      engine: 'google_maps_reviews',
      place_id: PLACE_ID,
      hl: 'es',
      sort_by: 'newestFirst',
      api_key: apiKey
    };
    if (token) params.next_page_token = token;

    const query = Object.keys(params)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');

    const res = UrlFetchApp.fetch(SERPAPI_BASE_URL + '?' + query, { method: 'get', muteHttpExceptions: true });
    callsUsed++;

    if (res.getResponseCode() >= 300) {
      console.error('backfillMonthlyHistory_: HTTP error', res.getResponseCode(), res.getContentText());
      stopReason = 'error HTTP';
      break;
    }

    let data;
    try {
      data = JSON.parse(res.getContentText());
    } catch (e) {
      console.error('backfillMonthlyHistory_: JSON error', e);
      stopReason = 'error de JSON';
      break;
    }

    const reviews = Array.isArray(data.reviews) ? data.reviews : [];
    if (!reviews.length) { stopReason = 'sin más reseñas'; break; }

    for (const r of reviews) {
      const iso = r.iso_date_of_last_edit || r.iso_date || r.date;
      if (!iso) continue;
      const d = new Date(toIso_(iso));
      if (isNaN(d.getTime())) continue;
      if (d < oldestSeen) oldestSeen = d;
      const mk = monthKeyOf_(d);
      counts[mk] = (counts[mk] || 0) + 1;
    }

    token = data.serpapi_pagination && data.serpapi_pagination.next_page_token;
    if (!token) stopReason = 'sin más páginas';

    Utilities.sleep(300); // pequeño respiro entre llamadas
  } while (token && callsUsed < MAX_CALLS && oldestSeen > cutoff);

  if (callsUsed >= MAX_CALLS) stopReason = 'tope de ' + MAX_CALLS + ' llamadas';
  if (oldestSeen <= cutoff) stopReason = 'cubiertos los ' + MONTHS_BACK + ' meses';

  // Construye el array final: solo confiamos en un mes si hemos paginado
  // hasta ANTES de que empezara ese mes (si no, el conteo sería parcial
  // y mostraríamos un "no cumplido" falso en vez de "sin datos").
  const history = [];
  for (let i = MONTHS_BACK; i >= 1; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = monthKeyOf_(monthStart);
    const covered = oldestSeen < monthStart;
    if (covered) {
      const count = counts[mk] || 0;
      history.push({ monthKey: mk, count, met: count >= MONTHLY_GOAL });
    } else {
      history.push({ monthKey: mk, count: null, met: null });
    }
  }

  const ps = PropertiesService.getScriptProperties();
  ps.setProperty('MONTHLY_HISTORY', JSON.stringify(history));
  // A partir de ya, el mes en curso lo cierra el mecanismo normal
  // (finalizeMonthlyHistoryIfNeeded_ en api_public.js) cuando cambie el mes.
  ps.setProperty('HISTORY_LAST_MONTH_KEY', currentMonthKey);

  const summary = {
    callsUsed,
    stopReason,
    oldestSeenIso: oldestSeen.toISOString(),
    history
  };
  console.log('backfillMonthlyHistory_ RESULTADO:', JSON.stringify(summary));
  return summary;
}

function monthKeyOf_(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * Migración de un solo uso (sin gastar ninguna llamada a SerpApi):
 * - Vuelca los meses ya cerrados que trajo backfillMonthlyHistory_() al
 *   nuevo formato MONTH_COUNTS (mapa monthKey -> nº reseñas), que ahora es
 *   la única fuente de verdad para el objetivo mensual y el histórico.
 * - Recalcula el mes en curso con precisión a partir de la fecha real de
 *   cada reseña ya guardada en la hoja GlowMetrics (readWindow_()), en vez
 *   de fiarse del "MONTH_START" antiguo, que se equivocaba si nadie cargaba
 *   la web justo al empezar el mes.
 * Se ejecuta una vez a mano (misma mecánica que el backfill: ruta temporal
 * en jsonRoute_, se llama una vez, se quita).
 */
function migrateToMonthCounts_() {
  const counts = {};

  // 1) Meses cerrados que ya trajo el backfill (dato ya pagado, no se
  //    vuelve a pedir a SerpApi).
  let raw = null;
  try {
    raw = PropertiesService.getScriptProperties().getProperty('MONTHLY_HISTORY');
  } catch (e) {}
  if (raw) {
    try {
      const old = JSON.parse(raw);
      for (const h of old) {
        if (h && h.monthKey && typeof h.count === 'number') {
          counts[h.monthKey] = h.count;
        }
      }
    } catch (e) {
      console.error('migrateToMonthCounts_ parse MONTHLY_HISTORY ERROR:', e);
    }
  }

  // 2) Mes en curso: recontado con precisión desde la ventana de reseñas
  //    que ya tenemos (sin llamar a SerpApi).
  const window = readWindow_() || [];
  const currentKey = monthKeyOf_(new Date());
  let currentCount = 0;
  for (const r of window) {
    if (!r || !r.publishedAt) continue;
    const d = new Date(r.publishedAt);
    if (isNaN(d.getTime())) continue;
    if (monthKeyOf_(d) === currentKey) currentCount++;
  }
  counts[currentKey] = currentCount;

  const ps = PropertiesService.getScriptProperties();
  ps.setProperty('MONTH_COUNTS', JSON.stringify(counts));
  ps.deleteProperty('MONTHLY_HISTORY');
  ps.deleteProperty('HISTORY_LAST_MONTH_KEY');

  const summary = { counts, currentKey, currentCount };
  console.log('migrateToMonthCounts_ RESULTADO:', JSON.stringify(summary));
  return summary;
}
