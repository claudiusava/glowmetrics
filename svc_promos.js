/*************************
 * svc_promos.js
 *
 * Unidades vendidas de las ofertas de campaña (Black Friday) con límite por centro. La hoja "Ofertas"
 * tiene UNA fila por oferta con el número de unidades vendidas; las ofertas y su límite están en
 * cfg_config.js (PROMO_OFFERS). La web enseña cuántas quedan y apunta cada venta a mano (flowww no tiene API).
 *
 * Todo cambio va dentro del candado y devuelve los números reales de todas las ofertas, así la pantalla
 * se corrige sola si dos personas venden a la vez. Vender una oferta agotada se rechaza aquí, no solo en
 * pantalla. Las escrituras llevan un clientId: la web las reintenta si Apps Script se atasca, y un
 * reintento no puede contar la venta dos veces (la marca se pone DESPUÉS de escribir, dentro del candado).
 *************************/

const PROMO_SHEET_NAME = 'Ofertas';
const PROMO_HEADERS = ['offer', 'sold', 'updatedAt'];
const PROMO_COLS = PROMO_HEADERS.length;

function ensurePromosSheet_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('promos_sheet_v1')) return;

  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(PROMO_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(PROMO_SHEET_NAME);
      sh.getRange(1, 1, 1, PROMO_COLS).setValues([PROMO_HEADERS]);
      // Texto plano: nada se interpreta como fecha ni fórmula.
      sh.getRange(1, 1, sh.getMaxRows(), PROMO_COLS).setNumberFormat('@');
      const now = new Date().toISOString();
      sh.getRange(2, 1, PROMO_OFFERS.length, PROMO_COLS).setValues(PROMO_OFFERS.map(o => [o.id, '0', now]));
    }
    cache.put('promos_sheet_v1', '1', 3600);
  });
}

/** Las filas de la hoja: id de oferta -> { row, sold }. */
function readPromoRows_(sh) {
  const map = {};
  const last = sh.getLastRow();
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, PROMO_COLS).getValues().forEach((r, i) => {
    const id = String(r[0] || '');
    if (id && !(id in map)) map[id] = { row: i + 2, sold: Math.max(0, Math.floor(Number(r[1]) || 0)) };
  });
  return map;
}

/** Unidades vendidas de cada oferta de la configuración (0 si todavía no tiene fila). */
function promoCounts_(rows) {
  const out = {};
  PROMO_OFFERS.forEach(o => { out[o.id] = rows[o.id] ? rows[o.id].sold : 0; });
  return out;
}

/** Todo lo que necesita la pantalla: la campaña, las ofertas con su límite y lo vendido de cada una. */
function getPromos() {
  ensurePromosSheet_();
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(PROMO_SHEET_NAME);
    return { campaign: PROMO_CAMPAIGN, offers: PROMO_OFFERS, sold: promoCounts_(readPromoRows_(sh)) };
  } catch (e) {
    // Nunca se responde "0 vendidas" por un fallo de lectura: la pantalla se queda con lo último que sabía.
    console.error('getPromos ERROR:', e);
    return { error: 'No se pudo leer.' };
  }
}

/**
 * Cambia las unidades vendidas de una oferta.
 *   'sell': +1 (rechazada con error 'sold-out' si ya no quedan)
 *   'undo': -1 (error 'nothing-to-undo' si no hay ventas)
 *   'set':  pone el número exacto (0..límite) para corregir descuadres
 * Idempotente por clientId. Devuelve siempre `counts` con los números reales de todas las ofertas.
 */
function changePromo_(kind, offerId, clientId, target) {
  ensurePromosSheet_();
  const offer = PROMO_OFFERS.find(o => o.id === String(offerId || ''));
  if (!offer) return { error: 'unknown-offer' };

  let wanted = 0;
  if (kind === 'set') {
    wanted = String(target == null ? '' : target).trim() === '' ? NaN : Number(target); // vacío no es 0
    if (!isFinite(wanted) || Math.floor(wanted) !== wanted || wanted < 0 || wanted > offer.limit) return { error: 'invalid-number' };
  }

  const cache = CacheService.getScriptCache();
  const dedupeKey = clientId ? 'promo_' + kind + '_' + String(clientId).slice(0, 100) : null;

  return withLock_(() => {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(PROMO_SHEET_NAME);
    const rows = readPromoRows_(sh);
    // Una copia repetida de la misma petición (reintento): ya está hecha, solo se devuelven los números.
    if (dedupeKey && cache.get(dedupeKey)) return { ok: true, counts: promoCounts_(rows) };

    const current = rows[offer.id] ? rows[offer.id].sold : 0;
    let next;
    if (kind === 'sell') {
      if (current >= offer.limit) return { error: 'sold-out', counts: promoCounts_(rows) };
      next = current + 1;
    } else if (kind === 'undo') {
      if (current <= 0) return { error: 'nothing-to-undo', counts: promoCounts_(rows) };
      next = current - 1;
    } else {
      next = wanted;
    }

    const rowNumber = rows[offer.id] ? rows[offer.id].row : sh.getLastRow() + 1;
    sh.getRange(rowNumber, 1, 1, PROMO_COLS).setValues([[offer.id, String(next), new Date().toISOString()]]);
    rows[offer.id] = { row: rowNumber, sold: next };
    if (dedupeKey) cache.put(dedupeKey, '1', 600);
    return { ok: true, counts: promoCounts_(rows) };
  });
}
