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
        const newCount = currentTotal - previousTotal;
        const ps = PropertiesService.getScriptProperties();
        ps.setProperty('LAST_SYNC_NEW_COUNT', String(newCount));
        ps.setProperty('LAST_SYNC_AT', new Date().toISOString());

        // Conteo mensual por fecha REAL de cada reseña nueva (no por "total
        // fotografiado al primer clic del mes", que se equivocaba si nadie
        // cargaba la web justo al empezar el mes). bundle.reviews viene
        // ordenado de más nueva a más antigua, así que las primeras
        // `newCount` son exactamente las que se acaban de añadir.
        recordReviewsInMonthCounts_((bundle.reviews || []).slice(0, newCount));

        // Las propiedades de arriba (badge, conteo mensual) se escriben
        // DESPUÉS de writeWindow_/setMeta_, que ya vaciaron la caché: la
        // vaciamos otra vez para que ninguna lectura intermedia deje una
        // copia con el badge viejo.
        invalidateReadCaches_();

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


/** Cuánto dura el aviso "🔥 +N" desde la sincronización que trajo la novedad. */
const NEW_REVIEWS_BADGE_TTL_MS = 24 * 60 * 60 * 1000;

/** Reseñas que trajo el último sync que realmente encontró novedades, SOLO
 * durante las 24 h siguientes a ese sync (0 si nunca hubo uno, si ya caducó o
 * si no hay fecha registrada). Antes el aviso se quedaba para siempre hasta
 * que otro sync trajera algo, y días después seguía diciendo "+1" mientras no
 * había nada nuevo. Compartido entre todos los clientes vía Script Properties. */
function getLastSyncNewCount_() {
  const ps = PropertiesService.getScriptProperties();
  const count = Number(ps.getProperty('LAST_SYNC_NEW_COUNT') || 0);
  if (!(count > 0)) return 0;

  const at = Date.parse(ps.getProperty('LAST_SYNC_AT') || '');
  if (isNaN(at)) return 0;
  if (Date.now() - at > NEW_REVIEWS_BADGE_TTL_MS) return 0;

  return count;
}

/** =========================
 * CONTEO MENSUAL POR FECHA REAL (MONTH_COUNTS)
 * =========================
 * Mapa { "YYYY-MM": nº reseñas } construido a partir de la fecha real de
 * publicación de cada reseña, actualizado en el momento del sync — no
 * depende de cuándo carga la web ningún cliente. Es la única fuente de
 * verdad tanto para el objetivo del mes en curso como para el histórico
 * de 12 meses.
 */
function getMonthCounts_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('MONTH_COUNTS');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('getMonthCounts_ parse ERROR:', e);
    return {};
  }
}

function saveMonthCounts_(counts) {
  // Recorta a los últimos 15 meses para no crecer sin límite.
  const keys = Object.keys(counts).sort();
  if (keys.length > 15) {
    keys.slice(0, keys.length - 15).forEach(k => delete counts[k]);
  }
  PropertiesService.getScriptProperties().setProperty('MONTH_COUNTS', JSON.stringify(counts));
  invalidateReadCaches_(); // objetivo mensual e histórico cacheados ya no valen
}

function recordReviewsInMonthCounts_(reviews) {
  if (!reviews || !reviews.length) return;
  const counts = getMonthCounts_();
  for (const r of reviews) {
    if (!r || !r.publishedAt) continue;
    const d = new Date(r.publishedAt);
    if (isNaN(d.getTime())) continue;
    const mk = monthKeyOf_(d);
    counts[mk] = (Number(counts[mk]) || 0) + 1;
  }
  saveMonthCounts_(counts);
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
