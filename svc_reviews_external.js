/** =========================
 * svc_review_external.gs (ESTABILIZADO)
 * =========================
 * Cambios:
 * - Lock + cooldown para evitar picos por varios clientes
 * - No cuenta contra el límite diario si la llamada falla antes de tener respuesta válida
 * - Manejo de errores más seguro (JSON parse, HTTP)
 * - Mantiene tu lógica de 1–2 llamadas y dedupe por id
 */

/** withLock_ y cooldownOk_ definidos una sola vez en api_public.js. */

/** =========================
 * SERPAPI HELPERS
 * ========================= */
function getSerpApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('SERPAPI_KEY');
  if (!key) throw new Error('Falta SERPAPI_KEY en Script Properties.');
  return key;
}

function serpApiSafeFetch_(params) {
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const now = new Date();
    const dayStr =
      now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    let storedDay = props.getProperty('SERPAPI_DAY');
    let dayCount = Number(props.getProperty('SERPAPI_DAY_COUNT') || 0);

    if (storedDay !== dayStr) {
      storedDay = dayStr;
      dayCount = 0;
      props.setProperty('SERPAPI_DAY', dayStr);
      props.setProperty('SERPAPI_DAY_COUNT', '0');
    }

    if (dayCount >= SERPAPI_DAILY_LIMIT) {
      console.error('SerpApi bloqueado: límite diario alcanzado (' + SERPAPI_DAILY_LIMIT + ').');
      return null;
    }

    // Cooldown para evitar duplicados cuando varios clientes llaman a la vez
    // (no evita llamadas cuando realmente hace falta, pero quita picos).
    if (!cooldownOk_('serpapi_call', 1500)) {
      // si hay demasiadas llamadas seguidas, devolvemos null y el caller ya hace fallback
      return null;
    }

    const apiKey = getSerpApiKey_();
    const fullParams = Object.assign({}, params, { api_key: apiKey });

    const query = Object.keys(fullParams)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(fullParams[k]))
      .join('&');

    const url = SERPAPI_BASE_URL + '?' + query;

    let res;
    try {
      res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    } catch (e) {
      console.error('SerpApi fetch EXCEPTION:', e);
      return null;
    }

    // Solo incrementa el contador si “hay respuesta”
    dayCount++;
    props.setProperty('SERPAPI_DAY_COUNT', String(dayCount));

    return res;
  });
}

/** =========================
 * SERPAPI: TOTAL Y RESEÑAS
 * ========================= */

// Solo total de reseñas (place_info.reviews)
function getSerpApiTotalReviews_() {
  const res = serpApiSafeFetch_({
    engine: 'google_maps_reviews',
    place_id: PLACE_ID,
    hl: 'es'
  });

  if (!res) return null;

  const code = res.getResponseCode();
  if (code >= 300) {
    console.error('getSerpApiTotalReviews_ HTTP ERROR:', code, res.getContentText());
    return null;
  }

  let data;
  try {
    data = JSON.parse(res.getContentText());
  } catch (e) {
    console.error('getSerpApiTotalReviews_ JSON parse ERROR:', e);
    return null;
  }

  const total = data && data.place_info ? data.place_info.reviews : null;
  if (typeof total === 'number' && !isNaN(total)) return total;

  console.error('getSerpApiTotalReviews_: place_info.reviews no encontrado.');
  return null;
}

// Últimas N reseñas (N <= 20)
function fetchReviewsFromSerpApi_(limit) {
  const max = Math.min(Number(limit || INITIAL_WINDOW_SIZE) || INITIAL_WINDOW_SIZE, 20);

  try {
    // 1) Primera página
    const res1 = serpApiSafeFetch_({
      engine: 'google_maps_reviews',
      place_id: PLACE_ID,
      hl: 'es',
      sort_by: 'newestFirst'
    });

    if (!res1) return [];

    if (res1.getResponseCode() >= 300) {
      console.error('SERPAPI CALL 1 ERROR:', res1.getResponseCode(), res1.getContentText());
      return [];
    }

    let data1;
    try { data1 = JSON.parse(res1.getContentText()); }
    catch (e) {
      console.error('SERPAPI CALL 1 JSON parse ERROR:', e);
      return [];
    }

    const token = data1 && data1.serpapi_pagination ? data1.serpapi_pagination.next_page_token : null;
    const raw1 = Array.isArray(data1.reviews) ? data1.reviews : [];

    let raw2 = [];
    if (token && max > 8) {
      const res2 = serpApiSafeFetch_({
        engine: 'google_maps_reviews',
        place_id: PLACE_ID,
        next_page_token: token,
        num: max,
        hl: 'es',
        sort_by: 'newestFirst'
      });

      if (res2 && res2.getResponseCode() < 300) {
        try {
          const data2 = JSON.parse(res2.getContentText());
          raw2 = Array.isArray(data2.reviews) ? data2.reviews : [];
        } catch (e) {
          console.error('SERPAPI CALL 2 JSON parse ERROR:', e);
        }
      } else if (res2) {
        console.error('SERPAPI CALL 2 ERROR:', res2.getResponseCode(), res2.getContentText());
      }
    }

    const allRaw = raw1.concat(raw2);

    const seen = new Set();
    const reviews = allRaw.map(r => {
      if (!r) return null;

      const iso = r.iso_date_of_last_edit || r.iso_date || r.date || null;

      const text =
        (r.extracted_snippet && (r.extracted_snippet.translated || r.extracted_snippet.original)) ||
        r.snippet ||
        '';

      const id = r.review_id || r.link || '';
      if (!id) return null;
      if (seen.has(id)) return null;
      seen.add(id);

      return {
        reviewId: id,
        rating: Number(r.rating || 0),
        author: (r.user && r.user.name) || 'Anónimo',
        text: text,
        publishedAt: iso ? toIso_(iso) : new Date().toISOString(),
        source: 'serpapi'
      };
    }).filter(Boolean);

    // newest first
    reviews.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return reviews.slice(0, max);
  } catch (e) {
    console.error('fetchReviewsFromSerpApi_ ERROR:', e);
    return [];
  }
}

// Devuelve { total, reviews } con 1ª página (y 2ª solo si hace falta)
function fetchLatestReviewsAndTotalFromSerpApi_(limit) {
  const max = Math.min(Number(limit || INITIAL_WINDOW_SIZE) || INITIAL_WINDOW_SIZE, 20);

  try {
    // 1) Primera página (aquí viene total + reviews + token)
    const res1 = serpApiSafeFetch_({
      engine: 'google_maps_reviews',
      place_id: PLACE_ID,
      hl: 'es',
      sort_by: 'newestFirst'
      // OJO: no ponemos num aquí para no depender de comportamientos raros
    });
    if (!res1) return { total: null, reviews: [] };

    if (res1.getResponseCode() >= 300) {
      console.error('SERPAPI BUNDLE CALL 1 ERROR:', res1.getResponseCode(), res1.getContentText());
      return { total: null, reviews: [] };
    }

    let data1;
    try { data1 = JSON.parse(res1.getContentText()); }
    catch (e) {
      console.error('SERPAPI BUNDLE CALL 1 JSON ERROR:', e);
      return { total: null, reviews: [] };
    }

    const total = (data1 && data1.place_info) ? data1.place_info.reviews : null;
    const token = data1 && data1.serpapi_pagination ? data1.serpapi_pagination.next_page_token : null;
    const raw1 = Array.isArray(data1.reviews) ? data1.reviews : [];

    // 2) Segunda página solo si hace falta (si la 1ª no trae suficiente)
    let raw2 = [];
    if (token && max > raw1.length) {
      const res2 = serpApiSafeFetch_({
        engine: 'google_maps_reviews',
        place_id: PLACE_ID,
        next_page_token: token,
        num: max,
        hl: 'es',
        sort_by: 'newestFirst'
      });

      if (res2 && res2.getResponseCode() < 300) {
        try {
          const data2 = JSON.parse(res2.getContentText());
          raw2 = Array.isArray(data2.reviews) ? data2.reviews : [];
        } catch (e) {
          console.error('SERPAPI BUNDLE CALL 2 JSON ERROR:', e);
        }
      } else if (res2) {
        console.error('SERPAPI BUNDLE CALL 2 ERROR:', res2.getResponseCode(), res2.getContentText());
      }
    }

    const allRaw = raw1.concat(raw2);

    const seen = new Set();
    const reviews = allRaw.map(r => {
      if (!r) return null;

      const iso = r.iso_date_of_last_edit || r.iso_date || r.date || null;
      const text =
        (r.extracted_snippet && (r.extracted_snippet.translated || r.extracted_snippet.original)) ||
        r.snippet ||
        '';

      const id = r.review_id || r.link || '';
      if (!id) return null;
      if (seen.has(id)) return null;
      seen.add(id);

      return {
        reviewId: id,
        rating: Number(r.rating || 0),
        author: (r.user && r.user.name) || 'Anónimo',
        text: text,
        publishedAt: iso ? toIso_(iso) : new Date().toISOString(),
        source: 'serpapi'
      };
    }).filter(Boolean);

    // newest first
    reviews.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return {
      total: (typeof total === 'number' && !isNaN(total)) ? total : null,
      reviews: reviews.slice(0, max)
    };
  } catch (e) {
    console.error('fetchLatestReviewsAndTotalFromSerpApi_ ERROR:', e);
    return { total: null, reviews: [] };
  }
}
