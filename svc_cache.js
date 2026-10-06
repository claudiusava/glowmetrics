/*************************
 * svc_cache.js
 *
 * Caché de LECTURAS en CacheService. Los datos que muestra la web (reseñas,
 * KPI de Airtable, objetivo mensual, histórico, consejos) solo cambian cuando
 * corre un trigger (sync de reseñas, job de Airtable) o alguien edita una hoja
 * a mano, pero cada cliente los pedía a cada carga y cada minuto: abrir la
 * hoja, leerla y, encima, escribir una copia "last-good" en Script Properties
 * en cada petición. Con la caché, esas lecturas pasan a ser una consulta en
 * memoria.
 *
 * Reglas:
 * - Solo se cachean respuestas BUENAS (nunca un fallback ni una lista vacía).
 * - Los writers (sync, job de Airtable) llaman a invalidateReadCaches_() al
 *   terminar, así que tras un sync los clientes ven lo nuevo enseguida; el
 *   TTL solo acota ediciones manuales de las hojas.
 * - NO se cachean las notas (se escriben desde la propia web y una lectura
 *   cacheada podría esconder una nota recién guardada).
 * - Nada de aquí llama a SerpApi ni a Airtable.
 *************************/

const READ_CACHE_PREFIX = 'rc_';
const READ_CACHE_TTL_S = {
  reviews: 120,
  kpi: 300,
  goal: 300,
  history: 900,
  tips: 300
};

function readCacheGet_(name) {
  try {
    const raw = CacheService.getScriptCache().get(READ_CACHE_PREFIX + name);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function readCachePut_(name, value) {
  try {
    const raw = JSON.stringify(value);
    if (raw.length > 90000) return; // límite de CacheService: 100 KB por valor
    CacheService.getScriptCache().put(READ_CACHE_PREFIX + name, raw, READ_CACHE_TTL_S[name] || 60);
  } catch (e) {
    console.error('readCachePut_ ERROR (' + name + '):', e);
  }
}

function invalidateReadCaches_() {
  try {
    const keys = Object.keys(READ_CACHE_TTL_S).map(k => READ_CACHE_PREFIX + k);
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) {
    console.error('invalidateReadCaches_ ERROR:', e);
  }
}

/** Una ventana de reseñas solo se cachea si es "de verdad": la misma
 * condición con la que initialize() da por buenos los datos guardados. */
function putReviewsCache_(totalCount, reviews, newReviewsCount) {
  if (!Array.isArray(reviews) || reviews.length < INITIAL_WINDOW_SIZE) return;
  if (!(Number(totalCount) > 0)) return;
  readCachePut_('reviews', {
    ready: true,
    totalCount: Number(totalCount),
    reviews: reviews,
    newReviewsCount: Number(newReviewsCount) || 0
  });
}

/** Reseñas + total + badge "+N nuevas", SOLO LECTURA. Si todavía no hay una
 * ventana completa guardada devuelve ready:false (y lo que haya): en ese caso
 * el frontend cae a initialize(), que es quien sabe hacer la primera carga. */
function getReviewsBundle_() {
  const cached = readCacheGet_('reviews');
  if (cached && cached.ready) return cached;

  return withLock_(() => {
    ensureSheets_();
    const meta = getMeta_() || {};
    const totalCount = Number(meta.totalCount) || 0;
    const stored = readWindow_() || [];
    const newReviewsCount = getLastSyncNewCount_();

    if (stored.length >= INITIAL_WINDOW_SIZE && totalCount > 0) {
      putReviewsCache_(totalCount, stored, newReviewsCount);
      return { ready: true, totalCount, reviews: stored, newReviewsCount };
    }
    return { ready: false, totalCount, reviews: stored, newReviewsCount };
  });
}

/** Todo lo que necesita la pantalla al abrir, en UNA sola petición (antes
 * eran 5-6, cada una con su arranque en frío y su turno en el lock). Cada
 * parte va aislada: si una falla llega null y el resto sigue funcionando. */
function getBootstrap() {
  const out = { reviews: null, kpi: null, goal: null, history: null, tips: null };

  const parts = [
    ['reviews', getReviewsBundle_],
    ['kpi', function () { return getAirtablePercentage(); }],
    ['goal', getMonthlyReviewCount],
    ['history', getMonthlyHistory],
    ['tips', getSalesTips]
  ];

  parts.forEach(function (p) {
    try {
      out[p[0]] = p[1]();
    } catch (e) {
      console.error('getBootstrap ' + p[0] + ' ERROR:', e);
    }
  });

  return out;
}
