/*************************
 * svc_followups.js
 *
 * Repasos de clientas que ya terminaron el tratamiento pero necesitan un repaso
 * al año (o dos): se apunta el nombre y el día que toca, y la web avisa ese día.
 * Sustituye a la pestaña de notas.
 *
 * Se guarda el nombre y los apellidos (decisión del dueño) y una nota breve, pero
 * NUNCA el teléfono ni otros datos: la API es pública (sin contraseña). El teléfono
 * se busca en flowww al avisar.
 *
 * Misma filosofía que Limpieza y la lista de espera: hoja propia con todo como texto
 * plano, alta idempotente por clientId y cambios/borrados con candado (la fila se
 * localiza por posición). Usa todayMadrid_ y normalizeCleaningDate_ de svc_cleaning.js.
 *************************/

const FOLLOWUP_SHEET_NAME = 'Repasos';
const FOLLOWUP_HEADERS = ['id', 'name', 'due', 'note', 'createdAt'];
const FOLLOWUP_COLS = FOLLOWUP_HEADERS.length;
const FOLLOWUP_MAX_ROWS = 2000;
const FOLLOWUP_MIN_DATE = '2025-01-01';
const FOLLOWUP_MAX_DATE = '2045-12-31';
const FOLLOWUP_NAME_MAX = 60;
const FOLLOWUP_NOTE_MAX = 80;

function ensureFollowupSheet_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('followup_sheet_v1')) return;

  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(FOLLOWUP_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(FOLLOWUP_SHEET_NAME);
      sh.getRange(1, 1, 1, FOLLOWUP_COLS).setValues([FOLLOWUP_HEADERS]);
      // Texto plano: "2026-11-30" no se convierte en fecha ni nada se interpreta como fórmula.
      sh.getRange(1, 1, sh.getMaxRows(), FOLLOWUP_COLS).setNumberFormat('@');
    }
    cache.put('followup_sheet_v1', '1', 3600);
  });
}

function cleanFollowupDate_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  if (s < FOLLOWUP_MIN_DATE || s > FOLLOWUP_MAX_DATE) return '';
  return s;
}

function rowToFollowup_(r) {
  return {
    id: String(r[0]),
    name: String(r[1] || ''),
    due: normalizeCleaningDate_(r[2]),
    note: String(r[3] || ''),
    createdAt: String(r[4] || '')
  };
}

/** Todos los repasos, el que antes toca primero. Solo lectura. */
function getFollowups() {
  ensureFollowupSheet_();
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(FOLLOWUP_SHEET_NAME);
    if (!sh) return [];
    const last = sh.getLastRow();
    if (last <= 1) return [];
    const first = Math.max(2, last - FOLLOWUP_MAX_ROWS + 1);
    return sh.getRange(first, 1, last - first + 1, FOLLOWUP_COLS).getValues()
      .filter(r => r[0])
      .map(rowToFollowup_)
      .filter(f => f.due)
      .sort((a, b) => (a.due + a.createdAt).localeCompare(b.due + b.createdAt));
  } catch (e) {
    console.error('getFollowups ERROR:', e);
    return [];
  }
}

/** Alta. Idempotente por clientId (un reintento tras un corte no duplica). */
function addFollowup_(params, clientId) {
  ensureFollowupSheet_();
  params = params || {};

  const cache = CacheService.getScriptCache();
  const dedupeKey = clientId ? 'followup_add_' + String(clientId).slice(0, 100) : null;
  if (dedupeKey && cache.get(dedupeKey)) return { ok: true };

  const name = cleanText_(params.name, FOLLOWUP_NAME_MAX);
  if (!name) return { error: 'Falta el nombre.' };
  const due = cleanFollowupDate_(params.due);
  if (!due) return { error: 'Fecha no válida.' };
  const note = cleanText_(params.note, FOLLOWUP_NOTE_MAX);

  const row = [Utilities.getUuid(), name, due, note, new Date().toISOString()];
  withLock_(() => {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(FOLLOWUP_SHEET_NAME);
    // Fila nueva como TEXTO PLANO (con appendRow, Sheets convertiría la fecha).
    const rg = sh.getRange(sh.getLastRow() + 1, 1, 1, FOLLOWUP_COLS);
    rg.setNumberFormat('@');
    rg.setValues([row]);
  });
  // La marca de "ya hecho" va DESPUÉS de escribir: si el candado agota el tiempo (waitLock lanza
  // error) y la web reintenta, el reintento tiene que escribir de verdad, no contestar "ok" en vacío.
  if (dedupeKey) cache.put(dedupeKey, '1', 600);
  return { ok: true, item: rowToFollowup_(row) };
}

/** Cambia solo los campos que vengan en `patch` (nombre, fecha, nota). */
function updateFollowup_(id, patch) {
  ensureFollowupSheet_();
  patch = patch || {};
  if (!id) return { ok: false };
  return withLock_(() => {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(FOLLOWUP_SHEET_NAME);
    const last = sh.getLastRow();
    if (last <= 1) return { ok: false };
    const rows = sh.getRange(2, 1, last - 1, FOLLOWUP_COLS).getValues();
    const idx = rows.findIndex(r => String(r[0]) === String(id));
    if (idx === -1) return { ok: false };

    const item = rowToFollowup_(rows[idx]);
    if ('name' in patch) {
      const name = cleanText_(patch.name, FOLLOWUP_NAME_MAX);
      if (!name) return { error: 'Falta el nombre.' };
      item.name = name;
    }
    if ('due' in patch) {
      const due = cleanFollowupDate_(patch.due);
      if (!due) return { error: 'Fecha no válida.' };
      item.due = due;
    }
    if ('note' in patch) item.note = cleanText_(patch.note, FOLLOWUP_NOTE_MAX);

    const rg = sh.getRange(idx + 2, 1, 1, FOLLOWUP_COLS);
    rg.setNumberFormat('@');
    rg.setValues([[item.id, item.name, item.due, item.note, item.createdAt]]);
    return { ok: true, item: item };
  });
}

/** Quita un repaso de la lista. Con candado: la fila se localiza por posición. */
function deleteFollowup_(id) {
  ensureFollowupSheet_();
  if (!id) return { ok: false };
  return withLock_(() => {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(FOLLOWUP_SHEET_NAME);
    const last = sh.getLastRow();
    if (last <= 1) return { ok: false };
    const ids = sh.getRange(2, 1, last - 1, 1).getValues().flat();
    const idx = ids.findIndex(v => String(v) === String(id));
    if (idx === -1) return { ok: false };
    sh.deleteRow(idx + 2);
    return { ok: true };
  });
}
