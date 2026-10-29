/*************************
 * svc_cleaning.js
 *
 * Registro de limpieza del local (sustituye al papel de la pared): cada vez que
 * se hace una tarea se apunta quién la hizo y qué día. La web calcula desde
 * cuándo no se hace y a quién le toca. Las tareas, las personas y el reparto
 * justo están en cfg_config.js (CLEANING_*).
 *
 * Misma filosofía que la lista de espera (svc_waitlist.js): hoja propia,
 * alta idempotente por clientId, todo como texto plano en la hoja y el borrado
 * (que localiza la fila por posición) con candado.
 *************************/

const CLEANING_SHEET_NAME = 'Limpieza';
const CLEANING_HEADERS = ['id', 'task', 'who', 'date', 'note', 'createdAt'];
const CLEANING_COLS = CLEANING_HEADERS.length;
const CLEANING_MAX_ROWS = 3000;
const CLEANING_MIN_DATE = '2025-01-01'; // el papel empieza en enero de 2026; margen por si acaso

function ensureCleaningSheet_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('cleaning_sheet_v1')) return;

  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(CLEANING_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(CLEANING_SHEET_NAME);
      sh.getRange(1, 1, 1, CLEANING_COLS).setValues([CLEANING_HEADERS]);
      // Todo como texto plano: las fechas "2026-01-21" se quedan tal cual y nada se interpreta como fórmula.
      sh.getRange(1, 1, sh.getMaxRows(), CLEANING_COLS).setNumberFormat('@');
    }
    cache.put('cleaning_sheet_v1', '1', 3600);
  });
}

function todayMadrid_() {
  return Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
}

function cleanCleaningDate_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

/** La fecha de un apunte como "AAAA-MM-DD", venga como texto o como fecha de la hoja
 * (Google Sheets convierte un "2026-10-29" en una fecha de verdad, aunque se pida texto). */
function normalizeCleaningDate_(v) {
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Europe/Madrid', 'yyyy-MM-dd');
  }
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Europe/Madrid', 'yyyy-MM-dd');
}

function rowToCleaningEntry_(r) {
  return {
    id: String(r[0]),
    task: String(r[1] || ''),
    who: String(r[2] || ''),
    date: normalizeCleaningDate_(r[3]),
    note: String(r[4] || ''),
    createdAt: String(r[5] || '')
  };
}

/** Todo lo que necesita la pantalla: tareas, personas, reparto y los apuntes (más nuevos primero). */
function getCleaning() {
  ensureCleaningSheet_();
  const out = { tasks: CLEANING_TASKS, staff: CLEANING_STAFF, shares: CLEANING_SHARES, entries: [] };
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLEANING_SHEET_NAME);
    if (!sh) return out;
    const last = sh.getLastRow();
    if (last <= 1) return out;
    const first = Math.max(2, last - CLEANING_MAX_ROWS + 1);
    out.entries = sh.getRange(first, 1, last - first + 1, CLEANING_COLS).getValues()
      .filter(r => r[0])
      .map(rowToCleaningEntry_)
      .filter(e => e.date)
      .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  } catch (e) {
    console.error('getCleaning ERROR:', e);
  }
  return out;
}

/** Apunta una limpieza. Idempotente por clientId (un reintento tras un corte no duplica). */
function addCleaningEntry_(params, clientId) {
  ensureCleaningSheet_();
  params = params || {};

  const cache = CacheService.getScriptCache();
  const dedupeKey = clientId ? 'cleaning_add_' + String(clientId).slice(0, 100) : null;
  if (dedupeKey && cache.get(dedupeKey)) return { ok: true };

  const task = String(params.task || '');
  if (!CLEANING_TASKS.some(t => t.id === task)) return { error: 'Tarea desconocida.' };
  const who = String(params.who || '');
  if (CLEANING_STAFF.indexOf(who) === -1) return { error: 'Persona desconocida.' };

  const today = todayMadrid_();
  const date = params.date ? cleanCleaningDate_(params.date) : today;
  if (!date) return { error: 'Fecha no válida.' };
  if (date > today) return { error: 'La fecha no puede ser futura.' };
  if (date < CLEANING_MIN_DATE) return { error: 'Fecha demasiado antigua.' };

  const note = String(params.note == null ? '' : params.note).replace(/\s+/g, ' ').trim().slice(0, 40);

  if (dedupeKey) cache.put(dedupeKey, '1', 600);

  const row = [Utilities.getUuid(), task, who, date, note, new Date().toISOString()];
  withLock_(() => {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLEANING_SHEET_NAME);
    // La fila nueva se escribe como TEXTO PLANO: con appendRow, Sheets convertía "2026-10-29" en una fecha.
    const rg = sh.getRange(sh.getLastRow() + 1, 1, 1, CLEANING_COLS);
    rg.setNumberFormat('@');
    rg.setValues([row]);
  });
  return { ok: true, item: rowToCleaningEntry_(row) };
}

/** Borra un apunte equivocado. Con candado: la fila se localiza por posición. */
function deleteCleaningEntry_(id) {
  ensureCleaningSheet_();
  if (!id) return { ok: false };
  return withLock_(() => {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CLEANING_SHEET_NAME);
    const last = sh.getLastRow();
    if (last <= 1) return { ok: false };
    const ids = sh.getRange(2, 1, last - 1, 1).getValues().flat();
    const idx = ids.findIndex(v => String(v) === String(id));
    if (idx === -1) return { ok: false };
    sh.deleteRow(idx + 2);
    return { ok: true };
  });
}
