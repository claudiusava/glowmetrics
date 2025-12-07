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
 * CONSEJOS DE VENTAS
 * ========================= */
function getSalesTips() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Hoja 3');
  if (!sh) return [];
  const values = sh.getRange('A1:A').getValues().flat();
  return values.filter(v => typeof v === 'string' && v.trim().length > 0);
}
