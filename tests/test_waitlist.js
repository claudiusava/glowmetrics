// Lista de espera (svc_waitlist.js). Ejecutar:  node tests/test_waitlist.js
// Usa el código real; la hoja y las utilidades de Google son simuladas.
// Caso que motivó el test: en el campo "detalle" se escribe "Martes 24/11" (el día que puede la clienta) y la
// hoja lo convertía en una fecha de verdad (se veía "Tue Nov 24 2026 00:00:00 GMT+0100 ...").
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'svc_cleaning.js', 'svc_followups.js', 'svc_promos.js', 'tools_backfill.js'];

function entorno() {
  const store = new Map(), props = new Map();
  const sheets = {};
  const log = { inserted: [] };
  const mkSheet = name => {
    const rows = [];
    const textRows = new Set();
    // Como Sheets en una celda que NO es de texto plano: "martes 24/11" o "24/11" se guardan como fecha (de este año).
    const parse = v => {
      const m = typeof v === 'string' && /^(?:[a-záéíóú]+\s+)?(\d{1,2})\/(\d{1,2})$/i.exec(v.trim());
      return m ? new Date(Date.UTC(2026, +m[2] - 1, +m[1]) - 3600 * 1000) : v;
    };
    return {
      rows,
      getMaxRows: () => 1000,
      getMaxColumns: () => 11,
      getLastRow: () => rows.length,
      appendRow: r => { rows.push(r.map(parse)); }, // appendRow no respeta el formato de texto
      deleteRow: n => { rows.splice(n - 1, 1); },
      getRange: (r, c, nr, nc) => ({
        setNumberFormat: () => { for (let i = 0; i < (nr || 1); i++) textRows.add(r + i); },
        getValue: () => (rows[r - 1] || [])[c - 1],
        setValue: v => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; },
        getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
        setValues: v => { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((val, j) => { rows[r - 1 + i][c - 1 + j] = textRows.has(r + i) ? val : parse(val); }); }); }
      })
    };
  };
  let uuid = 0;
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    Date,
    CacheService: { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v), remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'id-' + (++uuid),
      // Solo el patrón 'u|d/M' (día de la semana 1-7 y día/mes) en hora de Madrid (noviembre = UTC+1)
      formatDate: (d, tz, fmt) => { const x = new Date(d.getTime() + 3600 * 1000); return ((x.getUTCDay() || 7)) + '|' + x.getUTCDate() + '/' + (x.getUTCMonth() + 1); }
    },
    SpreadsheetApp: { openById: () => ({
      getSheetByName: n => sheets[n] || null,
      insertSheet: n => { log.inserted.push(n); sheets[n] = mkSheet(n); return sheets[n]; }
    }) },
    ContentService: { MimeType: { JAVASCRIPT: 'js', JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    HtmlService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'), ctx);
  vm.runInContext('ensureSheets_ = function () {}; cooldownOk_ = function () { return true; };', ctx);
  return { run: c => vm.runInContext(c, ctx), sheets, log };
}

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const t = entorno();
const add = (p, cid) => t.run(`addWaitItem_(${JSON.stringify(p)}, ${JSON.stringify(cid)})`);
const upd = (id, p) => t.run(`updateWaitItem_(${JSON.stringify(id)}, ${JSON.stringify(p)})`);
const lista = () => t.run('getWaitlist()');

check('sin clientas al principio', lista().length === 0);

// El caso del salón: el detalle lleva el día que puede la clienta
let r = add({ name: 'MIA (602556527)', zones: 'Brazos completos', days: 'M', parts: 'M', detail: 'Martes 24/11' }, 'a1');
check('el alta responde bien', r.ok && r.item.detail === 'Martes 24/11', r);
check('el detalle "Martes 24/11" se guarda tal cual, como texto (no como fecha)', t.sheets.ListaEspera.rows[1][5] === 'Martes 24/11', t.sheets.ListaEspera.rows[1][5]);
check('al leer la lista sale "Martes 24/11"', lista()[0].detail === 'Martes 24/11', lista());

// Otros textos que Sheets también convertiría
r = add({ name: 'ANA', zones: '1/2', days: 'L', parts: 'T', detail: '24/11' }, 'a2');
check('"24/11" y "1/2" tampoco se convierten en fecha', lista()[1].detail === '24/11' && lista()[1].zones === '1/2', lista()[1]);

// Reintento con el mismo clientId (la web repite el alta si tarda)
const antes = t.sheets.ListaEspera.rows.length;
add({ name: 'ANA', zones: '1/2', days: 'L', parts: 'T', detail: '24/11' }, 'a2');
check('el mismo clientId no duplica la clienta', t.sheets.ListaEspera.rows.length === antes && lista().length === 2);

// Editar
const id = lista()[0].id;
r = upd(id, { detail: 'Jueves 26/11' });
check('editar el detalle con un día lo mantiene como texto', r.ok && r.item.detail === 'Jueves 26/11' && lista()[0].detail === 'Jueves 26/11', lista()[0]);

// Filas ya estropeadas (guardadas antes del arreglo): se ven legibles y se curan al editar
t.sheets.ListaEspera.rows.push(['id-x', 'LOLA', 'Axilas', 'V', 'M', new Date(Date.UTC(2026, 10, 24) - 3600 * 1000), 'pending', 0, '2026-11-18T10:00:00.000Z', '2026-11-18T10:00:00.000Z', '']);
check('una fila que ya era fecha se ve como "martes 24/11", no como el texto largo de fecha', lista()[2].detail === 'martes 24/11', lista()[2]);
upd('id-x', { name: 'LOLA' });
check('al editar esa fila, el texto queda guardado como texto', t.sheets.ListaEspera.rows[3][5] === 'martes 24/11', t.sheets.ListaEspera.rows[3]);

// Borrar y volver a añadir no desordena la hoja
t.run(`deleteWaitItem_(${JSON.stringify(id)})`);
add({ name: 'EVA', zones: 'Piernas', days: 'X', parts: 'M', detail: 'Miércoles 25/11' }, 'a3');
check('borrar y añadir: la nueva se guarda como texto y la lista queda en orden', lista().map(x => x.name).join() === 'ANA,LOLA,EVA' && lista()[2].detail === 'Miércoles 25/11', lista());

// Datos normales siguen igual
check('los días y la franja se guardan como antes', lista()[0].days === 'L' && lista()[0].parts === 'T');

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nLista de espera OK');
process.exit(failed ? 1 : 0);
