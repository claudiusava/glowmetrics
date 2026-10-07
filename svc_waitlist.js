/*************************
 * svc_waitlist.js
 *
 * Lista de espera de clientas: cuando no hay hueco en la agenda se apunta a la
 * clienta (nombre, zonas en texto libre, días de lunes a viernes, mañana o
 * tarde y un detalle corto) y cuando queda un hueco se la llama.
 *
 * Misma filosofía que el cuaderno de notas (svc_notes.js): hoja propia, sin el
 * lock compartido del proyecto, alta idempotente por clientId y las lecturas
 * devuelven siempre la lista entera. No se cachea (se escribe desde la propia
 * web y una lectura cacheada podría esconder un cambio recién guardado).
 *************************/

const WAITLIST_SHEET_NAME = 'ListaEspera';
const WAITLIST_HEADERS = ['id', 'name', 'zones', 'days', 'parts', 'detail', 'status', 'attempts', 'createdAt', 'updatedAt'];
const WAITLIST_COLS = WAITLIST_HEADERS.length;
const WAITLIST_MAX_ROWS = 500;
const WAITLIST_STATUSES = ['pending', 'noanswer', 'booked'];

function ensureWaitlistSheet_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('waitlist_sheet_ensured')) return;

  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(WAITLIST_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(WAITLIST_SHEET_NAME);
      sh.getRange(1, 1, 1, WAITLIST_COLS).setValues([WAITLIST_HEADERS]);
      // Todo como texto plano: un nombre que empiece por "=" no se interpreta
      // como fórmula de la hoja.
      sh.getRange(1, 1, sh.getMaxRows(), WAITLIST_COLS).setNumberFormat('@');
    }
    cache.put('waitlist_sheet_ensured', '1', 3600);
  });
}

function cleanText_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Días de lunes a viernes: L M X J V (X = miércoles), siempre en ese orden.
function cleanDays_(v) {
  const s = String(v == null ? '' : v).toUpperCase();
  return 'LMXJV'.split('').filter(c => s.indexOf(c) !== -1).join('');
}

// Franja: M = mañana, T = tarde.
function cleanParts_(v) {
  const s = String(v == null ? '' : v).toUpperCase();
  return 'MT'.split('').filter(c => s.indexOf(c) !== -1).join('');
}

function rowToWaitItem_(r) {
  return {
    id: String(r[0]),
    name: String(r[1] || ''),
    zones: String(r[2] || ''),
    days: String(r[3] || ''),
    parts: String(r[4] || ''),
    detail: String(r[5] || ''),
    status: WAITLIST_STATUSES.indexOf(String(r[6])) === -1 ? 'pending' : String(r[6]),
    attempts: Number(r[7]) || 0,
    createdAt: String(r[8] || ''),
    updatedAt: String(r[9] || '')
  };
}

function readWaitlistRows_(sh) {
  const last = sh.getLastRow();
  if (last <= 1) return [];
  const first = Math.max(2, last - WAITLIST_MAX_ROWS + 1);
  return sh.getRange(first, 1, last - first + 1, WAITLIST_COLS).getValues().filter(r => r[0]);
}

/** Lista completa en orden de llegada (la más antigua primero). Solo lectura. */
function getWaitlist() {
  ensureWaitlistSheet_();
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(WAITLIST_SHEET_NAME);
    if (!sh) return [];
    return readWaitlistRows_(sh).map(rowToWaitItem_);
  } catch (e) {
    console.error('getWaitlist ERROR:', e);
    return [];
  }
}

/** Alta. Idempotente por clientId: si el cliente reintenta tras un timeout y la
 * primera petición sí llegó a guardarse, no se duplica la clienta. */
function addWaitItem_(params, clientId) {
  ensureWaitlistSheet_();
  params = params || {};

  const cache = CacheService.getScriptCache();
  const dedupeKey = clientId ? 'waitlist_add_' + String(clientId).slice(0, 100) : null;
  if (dedupeKey && cache.get(dedupeKey)) {
    return { ok: true, items: getWaitlist() };
  }

  if (!cooldownOk_('waitlist_add', 1500)) {
    return { error: 'Espera un momento antes de añadir otra.', items: getWaitlist() };
  }

  const name = cleanText_(params.name, 80);
  if (!name) return { error: 'Falta el nombre.', items: getWaitlist() };

  if (dedupeKey) cache.put(dedupeKey, '1', 600);

  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(WAITLIST_SHEET_NAME);
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  sh.appendRow([
    id, name, cleanText_(params.zones, 200), cleanDays_(params.days), cleanParts_(params.parts),
    cleanText_(params.detail, 120), 'pending', 0, now, now
  ]);

  return { ok: true, id: id, items: getWaitlist() };
}

/** Cambia solo los campos que vengan en `patch` (nombre, zonas, días, franja,
 * detalle, estado). Pasar a "sin respuesta" suma un intento de llamada. */
function updateWaitItem_(id, patch) {
  ensureWaitlistSheet_();
  patch = patch || {};
  if (!id) return { ok: false, items: getWaitlist() };
  // Con candado: la fila se localiza por posición y un borrado simultáneo la desplazaría.
  return withLock_(() => updateWaitItemLocked_(id, patch));
}

function updateWaitItemLocked_(id, patch) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(WAITLIST_SHEET_NAME);
  const last = sh.getLastRow();
  if (last <= 1) return { ok: false, items: [] };

  const ids = sh.getRange(2, 1, last - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(id));
  if (idx === -1) return { ok: false, items: getWaitlist() };

  const rowNum = idx + 2;
  const cur = sh.getRange(rowNum, 1, 1, WAITLIST_COLS).getValues()[0];
  const item = rowToWaitItem_(cur);

  if ('name' in patch) {
    const name = cleanText_(patch.name, 80);
    if (!name) return { error: 'Falta el nombre.', items: getWaitlist() };
    item.name = name;
  }
  if ('zones' in patch) item.zones = cleanText_(patch.zones, 200);
  if ('days' in patch) item.days = cleanDays_(patch.days);
  if ('parts' in patch) item.parts = cleanParts_(patch.parts);
  if ('detail' in patch) item.detail = cleanText_(patch.detail, 120);
  if ('status' in patch && WAITLIST_STATUSES.indexOf(String(patch.status)) !== -1) {
    if (patch.status === 'noanswer') item.attempts += 1; // cada "sin respuesta" cuenta como un intento
    item.status = String(patch.status);
  }
  item.updatedAt = new Date().toISOString();

  sh.getRange(rowNum, 1, 1, WAITLIST_COLS).setValues([[
    item.id, item.name, item.zones, item.days, item.parts, item.detail,
    item.status, item.attempts, item.createdAt, item.updatedAt
  ]]);

  return { ok: true, items: getWaitlist() };
}

function deleteWaitItem_(id) {
  ensureWaitlistSheet_();
  if (!id) return { ok: false, items: getWaitlist() };
  // Con candado por el mismo motivo que updateWaitItem_: dos borrados a la vez
  // podrían calcular la fila antes de que el otro desplace las demás.
  return withLock_(() => deleteWaitItemLocked_(id));
}

function deleteWaitItemLocked_(id) {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(WAITLIST_SHEET_NAME);
  const last = sh.getLastRow();
  if (last <= 1) return { ok: false, items: [] };

  const ids = sh.getRange(2, 1, last - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v) === String(id));
  if (idx === -1) return { ok: false, items: getWaitlist() };

  sh.deleteRow(idx + 2);
  return { ok: true, items: getWaitlist() };
}
