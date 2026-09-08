/** =========================
 * LÓGICA RESEÑAS (ESTABILIZADA)
 * =========================
 * Cambios:
 * - Lock para evitar carreras (initialize/forceRebuild/manual calls)
 * - “last-good” para que el front no se rompa si SerpApi/Sheets falla
 * - Guardas placeUrl/totalCount de forma consistente
 * - Dedupe más robusto y numeración estable
 */

/** Helpers de estabilidad (withLock_, setLastGood_, getLastGood_) definidos
 * una sola vez en api_public.js para evitar duplicados entre archivos. */

/** =========================
 * “JOB” (antes trigger). Ahora: función segura, se puede llamar manualmente.
 * ========================= */
function scheduledSerpApiCheck() {
  return withLock_(() => {
    ensureSheets_();

    try {
      const meta = getMeta_() || {};
      const previousTotal = Number(meta.totalCount || 0);
      const placeUrl = meta.placeUrl || (typeof PLACE_URL !== 'undefined' ? PLACE_URL : '');

      // 1 sola llamada (total + últimas reseñas)
      const bundle = fetchLatestReviewsAndTotalFromSerpApi_(INITIAL_WINDOW_SIZE);
      const currentTotalRaw = bundle.total;

      if (currentTotalRaw == null) {
        console.error('scheduledSerpApiCheck: no se pudo obtener total desde SerpApi (bundle).');
        const payload = { updated: false, totalCount: previousTotal, reviews: readWindow_() || [] };
        setLastGood_('reviews_window', payload);
        return payload;
      }

      // No bajar nunca el total guardado por anomalías temporales
      const currentTotal = Math.max(previousTotal, Number(currentTotalRaw) || 0);

      // Detectar si hay nuevas (por total)
      if (currentTotal > previousTotal) {
        const windowBefore = readWindow_() || [];
        const merged = dedupeById_([...(bundle.reviews || []), ...windowBefore]).slice(0, INITIAL_WINDOW_SIZE);
        const renumbered = assignNumbers_(merged, currentTotal);

        writeWindow_(renumbered);
        setMeta_({ placeUrl, totalCount: currentTotal });

        // Guardamos cuántas trajo ESTE sync para el badge "+N nuevas" del
        // frontend. Va en Script Properties (no en localStorage) para que
        // todos los dispositivos/navegadores vean el mismo número, en vez
        // de que cada pantalla calcule su propia versión según cuándo
        // recargó por última vez.
        const ps = PropertiesService.getScriptProperties();
        ps.setProperty('LAST_SYNC_NEW_COUNT', String(currentTotal - previousTotal));
        ps.setProperty('LAST_SYNC_AT', new Date().toISOString());

        const payload = { updated: true, totalCount: currentTotal, reviews: renumbered };
        setLastGood_('reviews_window', payload);
        return payload;
      }

      // Sin cambios: aún así actualizamos total (por si antes estaba mal) y devolvemos ventana actual
      setMeta_({ placeUrl, totalCount: currentTotal });

      const payload = { updated: false, totalCount: currentTotal, reviews: readWindow_() || [] };
      setLastGood_('reviews_window', payload);
      return payload;

    } catch (e) {
      console.error('scheduledSerpApiCheck ERROR:', e);
      return getLastGood_('reviews_window', { updated: false, totalCount: 0, reviews: [] });
    }
  });
}


/** Reseñas que trajo el último sync que realmente encontró novedades
 * (0 si nunca hubo uno o si ya no queda registro). Compartido entre todos
 * los clientes vía Script Properties. */
function getLastSyncNewCount_() {
  const count = Number(PropertiesService.getScriptProperties().getProperty('LAST_SYNC_NEW_COUNT') || 0);
  return count > 0 ? count : 0;
}

/** =========================
 * UTILIDADES
 * ========================= */
function toIso_(value) {
  try {
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(value))) return String(value);
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (e) {}
  return new Date().toISOString();
}

function appendQuery_(url, params) {
  const hasQ = url.includes('?');
  const q = Object.keys(params).map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join('&');
  return url + (hasQ ? '&' : '?') + q;
}

/**
 * Numeración estable:
 * - En tu UI se renderiza en el orden del array (primera card arriba).
 * - Si el array va “nuevas primero”, entonces:
 *   i=0 -> #currentTotal
 *   i=1 -> #currentTotal-1
 */
function assignNumbers_(reviewsNewestFirst, currentTotal) {
  return (reviewsNewestFirst || []).map((r, i) => ({
    ...r,
    number: (Number(currentTotal) || 0) - i
  }));
}

/**
 * Dedupe robusto:
 * - Preferimos reviewId si existe.
 * - Si no, usamos combinación estable: author|publishedAt|rating|text
 */
function dedupeById_(arr) {
  const seen = new Set();
  const out = [];

  for (const x of (arr || [])) {
    const key = x && x.reviewId
      ? String(x.reviewId)
      : [
          x && x.author ? String(x.author) : '',
          x && x.publishedAt ? String(x.publishedAt) : '',
          x && x.rating != null ? String(x.rating) : '',
          x && x.text ? String(x.text) : ''
        ].join('|');

    if (!seen.has(key)) {
      seen.add(key);
      out.push(x);
    }
  }
  return out;
}
