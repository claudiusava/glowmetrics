/*************************
 * svc_notes.js
 *
 * Pizarra de notas compartida entre el centro y tú: una lista simple
 * (no post-its independientes) — autor, texto y hora, la más nueva
 * arriba. Al escribirse muy de vez en cuando, no hay riesgo real de que
 * dos personas se pisen al añadir una nota (cada nota es una fila nueva,
 * nunca se edita una fila existente).
 *************************/

const NOTES_SHEET_NAME = 'Notas';
const NOTES_MAX_RETURNED = 200;
const NOTE_TEXT_MAX_LEN = 5000;

function ensureNotesSheet_() {
  // Igual que ensureSheets_: se cachea para no comprobar la estructura
  // de la hoja en cada poll de cada cliente.
  const cache = CacheService.getScriptCache();
  if (cache.get('notes_sheet_ensured')) return;

  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(NOTES_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(NOTES_SHEET_NAME);
      sh.getRange(1, 1, 1, 4).setValues([['id', 'author', 'text', 'createdAt']]);
    }
    cache.put('notes_sheet_ensured', '1', 3600);
  });
}

/** Lista de notas, más nueva primero. Sin withLock_: es una lectura; el
 * peor caso es no ver una nota añadida hace milisegundos, sin importancia
 * para un tablón que se actualiza muy de vez en cuando. */
function getNotes() {
  ensureNotesSheet_();
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName(NOTES_SHEET_NAME);
    if (!sh) return [];

    const last = sh.getLastRow();
    if (last <= 1) return [];

    const values = sh.getRange(2, 1, last - 1, 4).getValues();
    const notes = values
      .filter(r => r[0]) // fila con id = fila real
      .map(r => ({
        id: String(r[0]),
        author: String(r[1] || ''),
        text: String(r[2] || ''),
        createdAt: String(r[3] || '')
      }))
      .reverse(); // más nueva primero

    return notes.slice(0, NOTES_MAX_RETURNED);
  } catch (e) {
    console.error('getNotes ERROR:', e);
    return [];
  }
}

/** Añade una nota (fila nueva, nunca se edita una existente) y devuelve
 * la lista actualizada para que el frontend no tenga que volver a pedirla.
 *
 * Sin withLock_ a propósito: appendRow() añade en su propia fila nueva sin
 * tocar las demás, y esta hoja ("Notas") es independiente de la de
 * reseñas — no hay nada real que proteger compartiendo el lock de todo
 * el proyecto con checkForUpdates/initialize. Compartirlo solo añadía
 * lentitud a TODA la app cuando alguien escribía notas seguidas. */
function addNote_(author, text, clientId) {
  ensureNotesSheet_();

  // appendRow() no es idempotente: si el cliente da timeout mientras esta
  // llamada sigue ejecutándose en el servidor y el usuario reintenta
  // pensando que falló, sin esto se crean dos filas para la misma nota.
  // El frontend manda el MISMO clientId en cada reintento de un mismo
  // intento; si ya lo vimos, devolvemos la lista actual sin volver a
  // escribir la fila.
  const cache = CacheService.getScriptCache();
  const dedupeKey = clientId ? 'notes_add_' + String(clientId).slice(0, 100) : null;
  if (dedupeKey && cache.get(dedupeKey)) {
    return { ok: true, notes: getNotes() };
  }

  // La ruta es pública (igual que el resto de la API) y no tiene
  // usuarios identificados, así que un cooldown corto y compartido basta
  // para frenar spam automático sin molestar a nadie escribiendo notas
  // de verdad (nadie manda dos notas distintas en menos de 3s).
  if (!cooldownOk_('notes_add', 3000)) {
    return { error: 'Espera un momento antes de añadir otra nota.', notes: getNotes() };
  }

  const cleanAuthor = String(author || 'Anónimo').trim().slice(0, 60) || 'Anónimo';
  const cleanText = String(text || '').trim().slice(0, NOTE_TEXT_MAX_LEN);
  if (!cleanText) {
    return { error: 'La nota está vacía.', notes: getNotes() };
  }

  // Reservamos el clientId ANTES de escribir para cerrar la ventana de un
  // reintento casi simultáneo (llega mientras esta misma llamada sigue en
  // curso, antes de que exista fila que detectar por contenido).
  if (dedupeKey) cache.put(dedupeKey, '1', 600);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(NOTES_SHEET_NAME);
  const id = Utilities.getUuid();
  const createdAt = new Date().toISOString();

  sh.appendRow([id, cleanAuthor, cleanText, createdAt]);

  return { ok: true, notes: getNotes() };
}

/** Edita el texto de una nota existente (mismo id, misma fecha de
 * creación — no "sube" al principio de la lista solo por editarla).
 * Sin withLock_: mismo motivo que addNote_. */
function editNote_(id, text) {
  ensureNotesSheet_();

  if (!cooldownOk_('notes_edit', 3000)) {
    return { error: 'Espera un momento antes de guardar otro cambio.', notes: getNotes() };
  }
  if (!id) return { ok: false, notes: getNotes() };

  const cleanText = String(text || '').trim().slice(0, NOTE_TEXT_MAX_LEN);
  if (!cleanText) {
    return { error: 'La nota no puede quedar vacía.', notes: getNotes() };
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(NOTES_SHEET_NAME);
  const last = sh.getLastRow();
  if (last <= 1) return { ok: false, notes: [] };

  const ids = sh.getRange(2, 1, last - 1, 1).getValues().flat();
  const rowIndex = ids.findIndex(v => String(v) === String(id));
  if (rowIndex === -1) return { ok: false, notes: getNotes() };

  sh.getRange(rowIndex + 2, 3).setValue(cleanText); // columna 3 = text
  return { ok: true, notes: getNotes() };
}

/** Borra una nota por id (cualquiera puede borrar cualquier nota — es un
 * equipo pequeño y de confianza, como un corcho físico). Sin withLock_:
 * mismo motivo que addNote_. */
function deleteNote_(id) {
  ensureNotesSheet_();
  if (!id) return { ok: false, notes: getNotes() };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(NOTES_SHEET_NAME);
  const last = sh.getLastRow();
  if (last <= 1) return { ok: false, notes: [] };

  const ids = sh.getRange(2, 1, last - 1, 1).getValues().flat();
  const rowIndex = ids.findIndex(v => String(v) === String(id));
  if (rowIndex === -1) return { ok: false, notes: getNotes() };

  sh.deleteRow(rowIndex + 2); // +2: cabecera + índice base 1
  return { ok: true, notes: getNotes() };
}
