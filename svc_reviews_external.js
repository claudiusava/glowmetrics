/** =========================
 * SERPAPI HELPERS
 * ========================= */
function getSerpApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('SERPAPI_KEY');
  if (!key) throw new Error('Falta SERPAPI_KEY en Script Properties.');
  return key;
}

function serpApiSafeFetch_(params) {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const dayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let storedDay = props.getProperty('SERPAPI_DAY');
  let dayCount = Number(props.getProperty('SERPAPI_DAY_COUNT') || 0);

  if (storedDay !== dayStr) {
    storedDay = dayStr;
    dayCount = 0;
    props.setProperty('SERPAPI_DAY', dayStr);
    props.setProperty('SERPAPI_DAY_COUNT', '0');
  }

  if (dayCount >= SERPAPI_DAILY_LIMIT) {
    console.error('SerpApi bloqueado: límite diario alcanzado (' + SERPAPI_DAILY_LIMIT + '). No se hace la llamada.');
    return null;
  }

  const apiKey = getSerpApiKey_();
  const fullParams = { ...params, api_key: apiKey };

  const query = Object.keys(fullParams)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(fullParams[k])}`)
    .join('&');

  const url = `${SERPAPI_BASE_URL}?${query}`;

  const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });

  dayCount++;
  props.setProperty('SERPAPI_DAY_COUNT', String(dayCount));

  return res;
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

  if (res.getResponseCode() >= 300) {
    console.error('getSerpApiTotalReviews_ HTTP ERROR:', res.getResponseCode(), res.getContentText());
    return null;
  }

  const data = JSON.parse(res.getContentText());
  const total = data?.place_info?.reviews;
  if (typeof total === 'number' && !isNaN(total)) return total;

  console.error('getSerpApiTotalReviews_: place_info.reviews no encontrado.');
  return null;
}

// Últimas N reseñas (N <= 20)
function fetchReviewsFromSerpApi_(limit) {
  const max = Math.min(limit || INITIAL_WINDOW_SIZE, 20);

  try {
    // 1) Primera página (sin num)
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
    const data1 = JSON.parse(res1.getContentText());
    const token = data1?.serpapi_pagination?.next_page_token || null;
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
        const data2 = JSON.parse(res2.getContentText());
        raw2 = Array.isArray(data2.reviews) ? data2.reviews : [];
      } else if (res2) {
        console.error('SERPAPI CALL 2 ERROR:', res2.getResponseCode(), res2.getContentText());
      }
    }

    const allRaw = raw1.concat(raw2);

    const seen = new Set();
    const reviews = allRaw.map(r => {
      const iso =
        r.iso_date_of_last_edit ||
        r.iso_date ||
        r.date ||
        null;

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

    reviews.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return reviews.slice(0, max);
  } catch (e) {
    console.error('fetchReviewsFromSerpApi_ ERROR:', e);
    return [];
  }
}
