/*************************
 *  CONFIG AIRTABLE
 *************************/
const AIRTABLE = {
  BASE_ID: 'appkC8oRh7XtpKEVN',
  TABLE_ID: 'tblVS5CHe2Vjb5HRv',
  VIEW_ID: 'viw43MlTmyROPwIXD', // vista
  FIELD_NAME: 'Field 5',        // campo que contiene "CITADA"
  CACHE_SECS: 900
};

function getAirtableToken_() {
  const pat = PropertiesService.getScriptProperties().getProperty('AIRTABLE_PAT');
  if (!pat) throw new Error('Falta AIRTABLE_PAT en Script Properties.');
  return pat;
}

/*************************
 *  % CITADAS (Airtable)
 *************************/
function getAirtableStats() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('airtable_stats');
  if (cached) return JSON.parse(cached);

  const token = getAirtableToken_();
  const base = AIRTABLE.BASE_ID;
  const table = AIRTABLE.TABLE_ID;
  const view = AIRTABLE.VIEW_ID;

  const baseUrl = `https://api.airtable.com/v0/${encodeURIComponent(base)}/${encodeURIComponent(table)}`;
  const params = [
    view ? `view=${encodeURIComponent(view)}` : '',
    `fields[]=${encodeURIComponent(AIRTABLE.FIELD_NAME)}`
  ].filter(Boolean).join('&');

  const options = {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };

  let total = 0, citadas = 0, offset = null, guard = 0;

  do {
    let url = baseUrl + (params ? `?${params}` : '');
    if (offset) url += (params ? '&' : '?') + 'offset=' + encodeURIComponent(offset);

    const res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() >= 300) {
      throw new Error('Airtable API error ' + res.getResponseCode() + ': ' + res.getContentText());
    }
    const data = JSON.parse(res.getContentText());

    const records = data.records || [];
    total += records.length;

    for (const r of records) {
      const v = r.fields && r.fields[AIRTABLE.FIELD_NAME];
      const text = typeof v === 'string' ? v : (v && v.name ? v.name : '');
      if ((text || '').toString().trim().toUpperCase() === 'CITADA') citadas++;
    }

    offset = data.offset || null;
    if (++guard > 100) break;
  } while (offset);

  const pct = total > 0 ? Math.round((citadas / total) * 10000) / 100 : 0;

  const payload = { total, citadas, pct };
  cache.put('airtable_stats', JSON.stringify(payload), AIRTABLE.CACHE_SECS);
  return payload;
}

function getAirtablePercentage() {
  return getAirtableStats();
}

function setAirtableTokenOnce_() {
  // PropertiesService.getScriptProperties().setProperty('AIRTABLE_PAT', 'pat_xxx');
  throw new Error('Edita esta función para establecer AIRTABLE_PAT una sola vez.');
}

/** =========================
 * CONFIGURACIÓN GENERAL
 * ========================= */
const SPREADSHEET_ID = '1o-z4-0XLKpmV_houX06G4DgAeImNWHkgoHPJBXxFZbQ';
const PLACE_URL = 'https://www.google.com/maps/place/SinVello!+Alcorc%C3%B3n+%7C+Depilaci%C3%B3n+L%C3%A1ser+Diodo/@40.35219,-3.8246795,15z/data=!4m6!3m5!1s0xd4189bcbbfacd33:0x4a3bdccdbd719687!8m2!3d40.35219!4d-3.8246795!16s%2Fg%2F11vlpq89hn?entry=ttu&g_ep=EgoyMDI1MTAxNC4wIKXMDSoASAFQAw%3D%3D';
const PLACE_ID = 'ChIJM836u7yJQQ0Rh5Zxvc3cO0o';
const INITIAL_WINDOW_SIZE = 20;
const MONTHLY_GOAL = 20;

/** =========================
 * CONFIG SERPAPI
 * ========================= */
// Guarda SERPAPI_KEY en Script Properties (igual que AIRTABLE_PAT)
const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';
const SERPAPI_DAILY_LIMIT = 20; // máximo llamadas/día (seguro)

/*************************
 * FRONTEND
 *************************/
function doGet() {
  ensureSheets_();
  const html = HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Reseñas del negocio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}

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

/** =========================
 * INICIALIZACIÓN
 * ========================= */

// Inicializa: si no hay datos, hace una pasada completa con SerpApi.
// Si hay datos, solo devuelve lo que hay en Sheets.
function initialize() {
  ensureSheets_();

  const meta = getMeta_();
  let { placeUrl, totalCount } = meta;

  if (!placeUrl && PLACE_URL) {
    placeUrl = PLACE_URL;
    setMeta_({ placeUrl, totalCount: 0 });
  }

  const stored = readWindow_();
  if (stored && stored.length >= INITIAL_WINDOW_SIZE && totalCount > 0) {
    return { totalCount, reviews: stored };
  }

  // Primera vez / reset: pedimos total + últimas 20 a SerpApi
  const result = scheduledSerpApiCheck();
  return { totalCount: result.totalCount, reviews: result.reviews };
}

/** =========================
 * CHECK PARA EL FRONT (SOLO LECTURA)
 * ========================= */

// El frontend puede seguir llamando a esto en polling.
// Aquí NO se llama SerpApi, solo leemos lo que haya en Sheets.
function checkForUpdates() {
  ensureSheets_();
  const meta = getMeta_();
  const reviews = readWindow_();
  return {
    updated: true,         // fuerza refresco en front siempre
    totalCount: meta.totalCount || 0,
    reviews
  };
}

/** =========================
 * LÓGICA PROGRAMADA (TRIGGERS)
 * ========================= */

// Esta función es la que se ejecuta 5 veces al día vía trigger.
// Aquí SÍ se llama SerpApi si hace falta.
function scheduledSerpApiCheck() {
  ensureSheets_();

  const meta = getMeta_();
  const previousTotal = Number(meta.totalCount || 0);
  const placeUrl = meta.placeUrl || PLACE_URL;

  const currentTotal = getSerpApiTotalReviews_();
  if (currentTotal == null) {
    console.error('scheduledSerpApiCheck: no se pudo obtener total de SerpApi.');
    return { updated: false, totalCount: previousTotal, reviews: readWindow_() };
  }

  if (currentTotal > previousTotal) {
    const diff = currentTotal - previousTotal;
    const toFetch = Math.min(diff, INITIAL_WINDOW_SIZE);

    const newOnes = fetchReviewsFromSerpApi_(toFetch);
    const windowBefore = readWindow_();
    const merged = dedupeById_([...newOnes, ...windowBefore]).slice(0, INITIAL_WINDOW_SIZE);
    const renumbered = assignNumbers_(merged, currentTotal);

    writeWindow_(renumbered);
    setMeta_({ placeUrl, totalCount: currentTotal });

    return { updated: true, totalCount: currentTotal, reviews: renumbered };
  }

  // Sin cambios
  return { updated: false, totalCount: currentTotal, reviews: readWindow_() };
}

/** =========================
 * OBJETIVO MENSUAL (solo desde Sheets)
 * ========================= */
function getMonthlyReviewCount() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0..11
  const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;

  const cache = CacheService.getScriptCache();
  const cacheKey = 'monthly_count_' + monthKey;

  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.count === 'number') return parsed;
    } catch (e) {}
  }

  let count = 0;
  try {
    const rows = readWindow_();
    for (const r of rows) {
      const d = new Date(r.publishedAt);
      if (!isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() === m) {
        count++;
      }
    }
  } catch (e) {
    console.error('getMonthlyReviewCount ERROR:', e);
  }

  const payload = { count, goal: MONTHLY_GOAL, monthKey };
  cache.put(cacheKey, JSON.stringify(payload), 600);
  return payload;
}

/** =========================
 * PERSISTENCIA (Sheets)
 * ========================= */
function ensureSheets_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let meta = ss.getSheetByName('Meta');
  if (!meta) {
    meta = ss.insertSheet('Meta');
    meta.getRange('A1').setValue('placeUrl');
    meta.getRange('B1').setValue('totalCount');
  }

  let reviews = ss.getSheetByName('Reviews');
  if (!reviews) {
    reviews = ss.insertSheet('Reviews');
    reviews.getRange(1, 1, 1, 7)
      .setValues([['reviewId', 'number', 'rating', 'author', 'text', 'publishedAt', 'source']]);
  }
}

function getMeta_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Meta');
  const placeUrl = sh.getRange('A2').getValue();
  const totalCount = Number(sh.getRange('B2').getValue() || 0);
  return { placeUrl, totalCount };
}

function setMeta_({ placeUrl, totalCount }) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Meta');
  if (placeUrl !== undefined) sh.getRange('A2').setValue(placeUrl);
  if (totalCount !== undefined) sh.getRange('B2').setValue(Number(totalCount || 0));
}

function writeWindow_(rows) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Reviews');
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 7).clearContent();

  const data = rows.map(r => [
    r.reviewId || '',
    Number(r.number || 0),
    Number(r.rating || 0),
    r.author || '',
    r.text || '',
    r.publishedAt || '',
    r.source || ''
  ]);

  if (data.length > 0) {
    sh.getRange(2, 1, data.length, 7).setValues(data);
  }
}

function readWindow_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Reviews');
  const last = sh.getLastRow();
  if (last <= 1) return [];
  const values = sh.getRange(2, 1, last - 1, 7).getValues();
  return values.map(r => ({
    reviewId: r[0],
    number: Number(r[1]),
    rating: Number(r[2]),
    author: r[3],
    text: r[4],
    publishedAt: r[5],
    source: r[6]
  }));
}

/** =========================
 * TRIGGERS
 * ========================= */

// Crea 5 triggers diarios: 8:00, 11:00, 15:00, 18:00, 21:00
function createSerpApiCheckTriggers() {
  const hours = [8, 11, 15, 18, 21];

  // Borramos triggers anteriores de esta función
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'scheduledSerpApiCheckWrapper') {
      ScriptApp.deleteTrigger(t);
    }
  });

  hours.forEach(h => {
    ScriptApp.newTrigger('scheduledSerpApiCheckWrapper')
      .timeBased()
      .atHour(h)
      .nearMinute(0)
      .everyDays(1)
      .create();
  });

  console.log('Triggers creados para scheduledSerpApiCheckWrapper a las: ' + hours.join(', '));
}

// Wrapper para usar en el trigger (los triggers no pueden pasar params)
function scheduledSerpApiCheckWrapper() {
  try {
    scheduledSerpApiCheck();
  } catch (e) {
    console.error('scheduledSerpApiCheckWrapper ERROR:', e);
  }
}

function listMyTriggers() {
  const list = ScriptApp.getProjectTriggers().map(t => ({
    func: t.getHandlerFunction(),
    type: t.getEventType()
  }));
  console.log(JSON.stringify(list, null, 2));
  return list;
}

function deleteSerpApiCheckTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'scheduledSerpApiCheckWrapper') {
      ScriptApp.deleteTrigger(t);
    }
  });
  console.log('Triggers de scheduledSerpApiCheckWrapper eliminados.');
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

function assignNumbers_(reviewsAscByTime, currentTotal) {
  return reviewsAscByTime.map((r, i) => ({ ...r, number: currentTotal - i }));
}

function dedupeById_(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const id = x.reviewId || JSON.stringify(x);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(x);
    }
  }
  return out;
}

/** =========================
 * CONSEJOS DE VENTAS
 * ========================= */
function getSalesTips() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Hoja 3');
  if (!sh) return [];
  const values = sh.getRange('A1:A').getValues().flat();
  return values.filter(v => typeof v === 'string' && v.trim().length > 0);
}
