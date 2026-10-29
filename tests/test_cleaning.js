// Registro de limpieza (svc_cleaning.js). Ejecutar:  node tests/test_cleaning.js
// Usa el código real; la hoja y las utilidades de Google son simuladas.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'svc_cleaning.js', 'tools_backfill.js'];

const AHORA = Date.parse('2026-10-29T10:00:00Z'); // 11:00 en Madrid, 29 de octubre

function entorno() {
  const store = new Map(), props = new Map();
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(AHORA); else super(...a); }
    static now() { return AHORA; }
  }
  const sheets = {};
  const log = { inserted: [], numberFormat: [] };
  const mkSheet = name => {
    const rows = [];
    return {
      rows,
      getMaxRows: () => 1000,
      getLastRow: () => rows.length,
      appendRow: r => { rows.push(r.slice()); },
      deleteRow: n => { rows.splice(n - 1, 1); },
      getRange: (r, c, nr, nc) => ({
        setNumberFormat: f => { log.numberFormat.push([name, f]); },
        getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
        setValues: v => { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((val, j) => { rows[r - 1 + i][c - 1 + j] = val; }); }); }
      })
    };
  };
  let uuid = 0;
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    Date: FakeDate,
    CacheService: { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v), remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'id-' + (++uuid),
      // Europe/Madrid en octubre = UTC+1 (ya terminó el horario de verano el día 25)
      formatDate: (d, tz, fmt) => new Date(d.getTime() + 3600 * 1000).toISOString().slice(0, 10)
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
  vm.runInContext('ensureSheets_ = function () {};', ctx);
  return { run: c => vm.runInContext(c, ctx), sheets, log };
}

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const t = entorno();

// Configuración y hoja
const vacio = t.run('getCleaning()');
check('la hoja Limpieza se crea sola, con formato de texto y cabecera', t.log.inserted.includes('Limpieza') && t.log.numberFormat.some(x => x[0] === 'Limpieza' && x[1] === '@') && t.sheets.Limpieza.rows[0].join() === 'id,task,who,date,note,createdAt');
check('sin apuntes al principio', vacio.entries.length === 0);
check('tareas: recepción, cabina 1, cabina 2, baño y cristales', vacio.tasks.map(x => x.id).join() === 'recepcion,cabina1,cabina2,bano,cristales', vacio.tasks);
check('plazos: 30, 21, 21, 15 y 60 días', vacio.tasks.map(x => x.everyDays).join() === '30,21,21,15,60');
check('personas: Elena y Laura, con reparto del 50 %', vacio.staff.join() === 'Elena,Laura' && vacio.shares.Elena === 50 && vacio.shares.Laura === 50);

// Alta
let r = t.run(`addCleaningEntry_({ task: 'bano', who: 'Laura' }, 'c1')`);
check('alta sin fecha: se apunta con la de hoy (29/10/2026, hora de Madrid)', r.ok && r.item.date === '2026-10-29' && r.item.who === 'Laura' && r.item.task === 'bano', r);
r = t.run(`addCleaningEntry_({ task: 'cabina1', who: 'Elena', date: '2026-10-27', note: '  solo   suelo ' }, 'c2')`);
check('alta con fecha pasada y nota limpia', r.ok && r.item.date === '2026-10-27' && r.item.note === 'solo suelo', r);
r = t.run(`addCleaningEntry_({ task: 'bano', who: 'Laura' }, 'c1')`);
check('idempotente: el mismo clientId no duplica', r.ok && !r.item && t.sheets.Limpieza.rows.length === 3, t.sheets.Limpieza.rows.length);

// Validaciones
const err = (code) => t.run(code).error;
check('tarea desconocida', err(`addCleaningEntry_({ task: 'ventanas', who: 'Laura' }, 'x1')`) === 'Tarea desconocida.');
check('persona desconocida', err(`addCleaningEntry_({ task: 'bano', who: 'Paco' }, 'x2')`) === 'Persona desconocida.');
check('fecha futura rechazada', !!err(`addCleaningEntry_({ task: 'bano', who: 'Laura', date: '2026-10-30' }, 'x3')`));
check('fecha mal escrita rechazada', !!err(`addCleaningEntry_({ task: 'bano', who: 'Laura', date: '29/10/2026' }, 'x4')`));
check('fecha antigua rechazada', !!err(`addCleaningEntry_({ task: 'bano', who: 'Laura', date: '2019-01-01' }, 'x5')`));
check('hoy (hora de Madrid) sí vale y mañana no', t.run(`addCleaningEntry_({ task: 'cristales', who: 'Elena', date: '2026-10-29' }, 'x6')`).ok === true);
check('lo rechazado no se guarda', t.sheets.Limpieza.rows.length === 4, t.sheets.Limpieza.rows.length);
const nota = t.run(`addCleaningEntry_({ task: 'bano', who: 'Elena', date: '2026-10-20', note: 'x'.repeat(100) }, 'x7')`);
check('la nota se limita a 40 caracteres', nota.item.note.length === 40);

// Lista: más nuevo primero (por fecha del apunte, no por orden de entrada)
t.run(`addCleaningEntry_({ task: 'recepcion', who: 'Laura', date: '2026-09-21' }, 'x8')`);
const lista = t.run('getCleaning()');
check('lista ordenada por fecha, la más reciente primero', lista.entries.map(e => e.date).join() === '2026-10-29,2026-10-29,2026-10-27,2026-10-20,2026-09-21', lista.entries.map(e => e.date));
check('una fecha antigua apuntada ahora no se cuela la primera', lista.entries[lista.entries.length - 1].task === 'recepcion');

// Borrado
const id = lista.entries[0].id;
check('borrar un apunte', t.run(`deleteCleaningEntry_('${id}')`).ok === true && t.run('getCleaning()').entries.length === 4);
check('borrar uno que no existe: ok:false y no toca nada', t.run(`deleteCleaningEntry_('no-existe')`).ok === false && t.run('getCleaning()').entries.length === 4);
check('borrar sin id: ok:false', t.run(`deleteCleaningEntry_('')`).ok === false);

// Rutas
const l = t.run(`jsonRoute_('cleaning-list', 'cb', {})`);
check('ruta cleaning-list devuelve JSONP con tareas y apuntes', l.text.startsWith('cb({') && JSON.parse(l.text.slice(3, -2)).entries.length === 4);
const a = t.run(`jsonRoute_('cleaning-add', 'cb', { task: 'cabina2', who: 'Laura', clientId: 'ruta-1' })`);
check('ruta cleaning-add guarda', JSON.parse(a.text.slice(3, -2)).item.task === 'cabina2');
const d = t.run(`jsonRoute_('cleaning-delete', 'cb', { id: '${JSON.parse(a.text.slice(3, -2)).item.id}' })`);
check('ruta cleaning-delete borra', JSON.parse(d.text.slice(3, -2)).ok === true && t.run('getCleaning()').entries.length === 4);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nLimpieza (servidor) OK');
process.exit(failed ? 1 : 0);
