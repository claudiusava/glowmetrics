/*************************
 * FRONTEND (API PÚBLICA)
 *************************/

/**
 * Helpers de estabilidad (lock + last-good + cooldown)
 * - No consumen APIs externas.
 * - Evitan carreras entre usuarios/recargas.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function setLastGood_(key, value) {
  PropertiesService.getScriptProperties().setProperty(
    'LG_' + key,
    JSON.stringify({ ts: new Date().toISOString(), value })
  );
}

function getLastGood_(key, fallback) {
  const raw = PropertiesService.getScriptProperties().getProperty('LG_' + key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && 'value' in parsed) ? parsed.value : fallback;
  } catch (e) {
    return fallback;
  }
}

function cooldownOk_(key, ms) {
  const ps = PropertiesService.getScriptProperties();
  const now = Date.now();
  const k = 'CD_' + key;
  const last = Number(ps.getProperty(k) || 0);
  if (now - last < ms) return false;
  ps.setProperty(k, String(now));
  return true;
}

/** =========================
 * WEB APP
 * ========================= */
function doGet(e) {
  ensureSheets_();

  // API JSON para el frontend Angular (GitHub Pages): .../exec?route=initialize, etc.
  // Nota: usamos query string y no pathInfo (.../exec/initialize) porque Apps Script
  // exige volver a iniciar sesión de Google en URLs con pathInfo, incluso con
  // acceso "Anyone" — solo el .../exec "pelado" es realmente anónimo.
  const route = e && e.parameter && e.parameter.route;
  if (route) {
    const callback = e.parameter.callback;
    return jsonRoute_(route, callback);
  }

  const template = HtmlService.createTemplateFromFile('index');
  template.__buildText = 'BUILD ' + new Date().toISOString(); // <-- ESTA LINEA

  return template
    .evaluate()
    .setTitle('GlowMetrics')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** =========================
 * API JSON (frontend Angular externo)
 * ========================= */
function jsonRoute_(route, callback) {
  const handlers = {
    'initialize': initialize,
    'updates': checkForUpdates,
    'monthly-goal': getMonthlyReviewCount,
    'sales-tips': getSalesTips,
    'airtable-kpi': getAirtablePercentage
  };

  const handler = handlers[route];
  const body = handler ? handler() : { error: 'Ruta no encontrada: ' + route };
  const json = JSON.stringify(body);

  // Apps Script no añade cabeceras CORS a las respuestas de ContentService,
  // así que el frontend (GitHub Pages) consume esta API vía JSONP.
  const isValidCallback = typeof callback === 'string' && /^[A-Za-z_$][\w$]*$/.test(callback);
  if (isValidCallback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/** =========================
 * INICIALIZACIÓN
 * ========================= */
// Inicializa: si no hay datos, hace una pasada completa.
// Si hay datos, solo devuelve lo que hay en Sheets.
// Estabilizado: lock + last-good + control de fallos.
function initialize() {
  return withLock_(() => {
    ensureSheets_();

    try {
      const meta = getMeta_();
      let { placeUrl, totalCount } = meta || {};

      if (!placeUrl && typeof PLACE_URL !== 'undefined' && PLACE_URL) {
        placeUrl = PLACE_URL;
        setMeta_({ placeUrl, totalCount: 0 });
        totalCount = 0;
      }

      const stored = readWindow_() || [];
      if (stored.length >= INITIAL_WINDOW_SIZE && Number(totalCount) > 0) {
        const payload = { totalCount: Number(totalCount) || 0, reviews: stored };
        setLastGood_('initialize', payload);
        return payload;
      }

      // Primera vez / reset: delega en tu función (aunque ahora no tengas triggers).
      // Si falla, devolvemos last-good o vacío controlado.
      const result = scheduledSerpApiCheck();
      const payload = {
        totalCount: Number(result && result.totalCount) || 0,
        reviews: (result && result.reviews) ? result.reviews : []
      };
      setLastGood_('initialize', payload);
      return payload;

    } catch (e) {
      console.error('initialize ERROR:', e);
      // Último valor bueno si existe; si no, estructura válida para el front.
      return getLastGood_('initialize', { totalCount: 0, reviews: [] });
    }
  });
}

/** =========================
 * CHECK PARA EL FRONT (SOLO LECTURA)
 * ========================= */
function checkForUpdates() {
  return withLock_(() => {
    ensureSheets_();

    // Evita martilleo si el front refresca de más (no bloquea: solo reutiliza last-good).
    if (!cooldownOk_('checkForUpdates', 3000)) {
      const lg = getLastGood_('checkForUpdates', null);
      if (lg) return lg;
    }

    try {
      const meta = getMeta_() || {};
      const reviews = readWindow_() || [];
      const payload = {
        updated: true,
        totalCount: Number(meta.totalCount) || 0,
        reviews
      };
      setLastGood_('checkForUpdates', payload);
      return payload;

    } catch (e) {
      console.error('checkForUpdates ERROR:', e);
      return getLastGood_('checkForUpdates', {
        updated: true,
        totalCount: 0,
        reviews: []
      });
    }
  });
}

/** =========================
 * OBJETIVO MENSUAL
 * ========================= */
function getMonthlyReviewCount() {
  return withLock_(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;

    // Cache primero (rápido)
    const cache = CacheService.getScriptCache();
    const cacheKey = 'monthly_count_' + monthKey;
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.count === 'number') return parsed;
      } catch (e) { }
    }

    try {
      const meta = getMeta_() || {};
      const totalNow = Number(meta.totalCount) || 0;

      // Guardamos el total al inicio del mes
      const ps = PropertiesService.getScriptProperties();
      const key = 'MONTH_START_' + monthKey;

      let startTotal = Number(ps.getProperty(key) || 0);

      if (!startTotal) {
        startTotal = totalNow;
        ps.setProperty(key, String(startTotal));
      }

      const count = Math.max(0, totalNow - startTotal);

      const payload = { count, goal: MONTHLY_GOAL, monthKey };
      cache.put(cacheKey, JSON.stringify(payload), 600);
      setLastGood_('monthly_' + monthKey, payload);
      return payload;

    } catch (e) {
      console.error('getMonthlyReviewCount ERROR:', e);
      const fallback = getLastGood_('monthly_' + monthKey, { count: 0, goal: MONTHLY_GOAL, monthKey });
      // Intentamos cachear también el fallback para estabilizar el front
      try { cache.put(cacheKey, JSON.stringify(fallback), 300); } catch (err) { }
      return fallback;
    }
  });
}

/** =========================
 * CONSEJOS DE VENTAS
 * ========================= */
function getSalesTips() {
  return withLock_(() => {
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sh = ss.getSheetByName('Hoja 3');
      if (!sh) return [];

      const values = sh.getRange('A1:A').getValues().flat();
      const tips = values.filter(v => typeof v === 'string' && v.trim().length > 0);

      setLastGood_('sales_tips', tips);
      return tips;

    } catch (e) {
      console.error('getSalesTips ERROR:', e);
      return getLastGood_('sales_tips', []);
    }
  });
}
