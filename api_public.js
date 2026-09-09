/*************************
 * FRONTEND (API PÚBLICA)
 *************************/

/**
 * Helpers de estabilidad (lock + last-good + cooldown)
 * - No consumen APIs externas.
 * - Evitan carreras entre usuarios/recargas.
 */
// Contador de reentrada: dentro de UNA misma ejecución, varias funciones
// públicas llaman a otras ya envueltas en withLock_ (p.ej. initialize()
// llama a ensureSheets_() y readWindow_(), que también usan withLock_).
// Como Apps Script ejecuta cada invocación en un solo hilo, un segundo
// waitLock() dentro de la misma ejecución nunca se libera a sí mismo y
// agota el timeout de 20s (interbloqueo). Esta variable vive solo durante
// la ejecución actual (no se comparte entre invocaciones concurrentes),
// así que solo tomamos el lock real la primera vez y reutilizamos el
// permiso en las llamadas anidadas.
let __lockDepth_ = 0;

function withLock_(fn) {
  if (__lockDepth_ > 0) {
    return fn();
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  __lockDepth_++;
  try {
    return fn();
  } finally {
    __lockDepth_--;
    lock.releaseLock();
  }
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
    'airtable-kpi': getAirtablePercentage,
    'refresh-airtable-kpi': manualRefreshAirtableKpi,
    'monthly-history': getMonthlyHistory
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
        const payload = { totalCount: Number(totalCount) || 0, reviews: stored, newReviewsCount: getLastSyncNewCount_() };
        setLastGood_('initialize', payload);
        return payload;
      }

      // Primera vez / reset: delega en tu función (aunque ahora no tengas triggers).
      // Si falla, devolvemos last-good o vacío controlado.
      const result = scheduledSerpApiCheck();
      const payload = {
        totalCount: Number(result && result.totalCount) || 0,
        reviews: (result && result.reviews) ? result.reviews : [],
        newReviewsCount: getLastSyncNewCount_()
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
        reviews,
        newReviewsCount: getLastSyncNewCount_()
      };
      setLastGood_('checkForUpdates', payload);
      return payload;

    } catch (e) {
      console.error('checkForUpdates ERROR:', e);
      return getLastGood_('checkForUpdates', {
        updated: true,
        totalCount: 0,
        reviews: [],
        newReviewsCount: 0
      });
    }
  });
}

/** =========================
 * OBJETIVO MENSUAL
 * ========================= */
// count sale de MONTH_COUNTS (fecha real de cada reseña, ver logic_reviews.js),
// no de un total "fotografiado" al primer acceso del mes — eso se equivocaba
// si nadie cargaba la web justo al empezar el mes.
function getMonthlyReviewCount() {
  return withLock_(() => {
    const monthKey = monthKeyOf_(new Date());

    try {
      const counts = getMonthCounts_();
      const count = Number(counts[monthKey]) || 0;

      const payload = { count, goal: MONTHLY_GOAL, monthKey };
      setLastGood_('monthly_' + monthKey, payload);
      return payload;

    } catch (e) {
      console.error('getMonthlyReviewCount ERROR:', e);
      return getLastGood_('monthly_' + monthKey, { count: 0, goal: MONTHLY_GOAL, monthKey });
    }
  });
}

/** =========================
 * HISTÓRICO DE OBJETIVOS (12 MESES)
 * ========================= */
// Últimos 11 meses CERRADOS (todo lo que hay en MONTH_COUNTS salvo el mes
// en curso, que ya se muestra aparte con getMonthlyReviewCount).
function getMonthlyHistory() {
  return withLock_(() => {
    try {
      const counts = getMonthCounts_();
      const currentKey = monthKeyOf_(new Date());

      const history = Object.keys(counts)
        .filter(mk => mk !== currentKey)
        .sort()
        .slice(-11)
        .map(mk => {
          const count = Number(counts[mk]) || 0;
          return { monthKey: mk, count, met: count >= MONTHLY_GOAL };
        });

      setLastGood_('monthly_history', history);
      return history;
    } catch (e) {
      console.error('getMonthlyHistory ERROR:', e);
      return getLastGood_('monthly_history', []);
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
