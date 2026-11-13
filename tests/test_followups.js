// Repasos de clientas (svc_followups.js). Ejecutar:  node tests/test_followups.js
// Usa el código real; la hoja y las utilidades de Google son simuladas.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'svc_cleaning.js', 'svc_followups.js', 'tools_backfill.js'];

const AHORA = Date.parse('2026-11-13T10:00:00Z'); // 11:00 en Madrid, 13 de noviembre

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
    const textRows = new Set();
    // Como Sheets: un texto "AAAA-MM-DD" se guarda como fecha si la celda no es de texto plano.
    const parse = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) - 3600 * 1000) : v;
    return {
      rows,
      getMaxRows: () => 1000,
      getLastRow: () => rows.length,
      appendRow: r => { rows.push(r.map(parse)); },
      deleteRow: n => { rows.splice(n - 1, 1); },
      getRange: (r, c, nr, nc) => ({
        setNumberFormat: f => { log.numberFormat.push([name, f]); for (let i = 0; i < (nr || 1); i++) if (f === '@') textRows.add(r + i); },
        getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
        setValues: v => { v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((val, j) => { rows[r - 1 + i][c - 1 + j] = textRows.has(r + i) ? val : parse(val); }); }); }
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
      formatDate: (d, tz, fmt) => new Date(d.getTime() + 3600 * 1000).toISOString().slice(0, 10) // Madrid en noviembre = UTC+1
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

// Hoja
check('sin repasos al principio', t.run('getFollowups()').length === 0);
check('la hoja Repasos se crea sola, con formato de texto y cabecera', t.log.inserted.includes('Repasos') && t.log.numberFormat.some(x => x[0] === 'Repasos' && x[1] === '@') && t.sheets.Repasos.rows[0].join() === 'id,name,due,note,createdAt');

// Alta
let r = t.run(`addFollowup_({ name: '  Marta   G. ', due: '2027-03-15', note: ' piernas  y axilas ' }, 'c1')`);
check('alta: nombre y nota limpios, fecha tal cual', r.ok && r.item.name === 'Marta G.' && r.item.due === '2027-03-15' && r.item.note === 'piernas y axilas', r);
r = t.run(`addFollowup_({ name: 'Marta G.', due: '2027-03-15' }, 'c1')`);
check('idempotente: el mismo clientId no duplica', r.ok && !r.item && t.sheets.Repasos.rows.length === 2, t.sheets.Repasos.rows.length);
r = t.run(`addFollowup_({ name: 'Lucía P.', due: '2026-11-13' }, 'c2')`);
check('un repaso para hoy se admite (sin nota)', r.ok && r.item.due === '2026-11-13' && r.item.note === '', r);
r = t.run(`addFollowup_({ name: 'Ana R.', due: '2026-10-01' }, 'c3')`);
check('un repaso ya pasado también se admite (se avisa enseguida)', r.ok === true, r);

// Validaciones
const err = code => t.run(code).error;
check('sin nombre', err(`addFollowup_({ name: '   ', due: '2027-01-01' }, 'x1')`) === 'Falta el nombre.');
check('sin fecha', err(`addFollowup_({ name: 'Eva', due: '' }, 'x2')`) === 'Fecha no válida.');
check('fecha mal escrita', err(`addFollowup_({ name: 'Eva', due: '15/03/2027' }, 'x3')`) === 'Fecha no válida.');
check('fecha absurda (año 2099)', err(`addFollowup_({ name: 'Eva', due: '2099-01-01' }, 'x4')`) === 'Fecha no válida.');
check('fecha antigua', err(`addFollowup_({ name: 'Eva', due: '2019-01-01' }, 'x5')`) === 'Fecha no válida.');
check('lo rechazado no se guarda', t.sheets.Repasos.rows.length === 4, t.sheets.Repasos.rows.length);
const largo = t.run(`addFollowup_({ name: 'N'.repeat(200), due: '2027-01-01', note: 'x'.repeat(300) }, 'x6')`);
check('nombre y nota se recortan (60 y 80)', largo.item.name.length === 60 && largo.item.note.length === 80);

// Lista: el que antes toca, primero
const lista = t.run('getFollowups()');
check('lista ordenada por fecha, la más próxima primero', lista.map(f => f.due).join() === '2026-10-01,2026-11-13,2027-01-01,2027-03-15', lista.map(f => f.due));

// Fechas: Sheets las convierte en fechas de verdad; la web siempre debe recibir "AAAA-MM-DD"
t.sheets.Repasos.rows.push(['id-fecha', 'Sara L.', new Date(Date.UTC(2027, 5, 9) - 3600 * 1000), '', '2026-11-13T00:00:00Z']);
check('una fecha que Sheets convirtió en fecha vuelve como AAAA-MM-DD', t.run('getFollowups()').some(f => f.id === 'id-fecha' && f.due === '2027-06-09'), t.run('getFollowups()'));

// Cambio (repasar de nuevo: nueva fecha)
const marta = lista.find(f => f.name === 'Marta G.');
r = t.run(`updateFollowup_('${marta.id}', { due: '2027-09-15' })`);
check('cambiar solo la fecha deja nombre y nota como estaban', r.ok && r.item.due === '2027-09-15' && r.item.name === 'Marta G.' && r.item.note === 'piernas y axilas', r);
r = t.run(`updateFollowup_('${marta.id}', { note: 'solo piernas' })`);
check('cambiar solo la nota deja la fecha', r.ok && r.item.note === 'solo piernas' && r.item.due === '2027-09-15', r);
r = t.run(`updateFollowup_('${marta.id}', { name: 'Marta Gómez' })`);
check('cambiar el nombre', r.ok && r.item.name === 'Marta Gómez', r);
check('fecha no válida al cambiar: se rechaza y no toca nada', t.run(`updateFollowup_('${marta.id}', { due: 'mañana' })`).error === 'Fecha no válida.' && t.run('getFollowups()').find(f => f.id === marta.id).due === '2027-09-15');
check('nombre vacío al cambiar: se rechaza', t.run(`updateFollowup_('${marta.id}', { name: ' ' })`).error === 'Falta el nombre.');
check('cambiar uno que no existe: ok:false', t.run(`updateFollowup_('no-existe', { due: '2027-01-01' })`).ok === false);
check('cambiar sin id: ok:false', t.run(`updateFollowup_('', { due: '2027-01-01' })`).ok === false);

// Borrado
const antes = t.run('getFollowups()').length;
check('quitar de la lista', t.run(`deleteFollowup_('${marta.id}')`).ok === true && t.run('getFollowups()').length === antes - 1);
check('quitar uno que no existe: ok:false y no toca nada', t.run(`deleteFollowup_('no-existe')`).ok === false && t.run('getFollowups()').length === antes - 1);
check('quitar sin id: ok:false', t.run(`deleteFollowup_('')`).ok === false);

// Rutas de la API
const ruta = (route, params = {}) => JSON.parse(t.run(`jsonRoute_(${JSON.stringify(route)}, null, ${JSON.stringify(params)})`).text);
check('ruta followups-list', Array.isArray(ruta('followups-list')));
const viaRuta = ruta('followups-add', { name: 'Eva M.', due: '2027-02-02', clientId: 'r1' });
check('ruta followups-add', viaRuta.ok && viaRuta.item.name === 'Eva M.', viaRuta);
check('ruta followups-update', ruta('followups-update', { id: viaRuta.item.id, due: '2027-08-08' }).item.due === '2027-08-08');
check('ruta followups-delete', ruta('followups-delete', { id: viaRuta.item.id }).ok === true);

// Si el candado agota el tiempo (waitLock lanza error), el reintento con el mismo clientId debe
// escribir de verdad: antes la marca "ya hecho" se ponía antes de escribir y el reintento perdía la fila.
{
  const u = entorno();
  u.run(`LockService.getScriptLock = () => ({ waitLock() { throw new Error('lock timeout'); }, releaseLock() {} })`);
  let threw = false;
  try { u.run(`addFollowup_({ name: 'Eva M.', due: '2027-02-02' }, 'k1')`); } catch (e) { threw = true; }
  check('candado agotado: el alta falla (lanza error)', threw);
  u.run(`LockService.getScriptLock = () => ({ waitLock() {}, releaseLock() {} })`);
  const re = u.run(`addFollowup_({ name: 'Eva M.', due: '2027-02-02' }, 'k1')`);
  check('el reintento tras un fallo SÍ escribe la fila', re.ok && u.run('getFollowups()').length === 1, re);
  u.run(`addFollowup_({ name: 'Eva M.', due: '2027-02-02' }, 'k1')`);
  check('y otro reintento ya no duplica', u.run('getFollowups()').length === 1);
}

console.log(failed ? `\n${failed} FALLOS` : '\nTodo bien');
process.exit(failed ? 1 : 0);
