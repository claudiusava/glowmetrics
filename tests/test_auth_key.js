// Clave de acceso de la API (api_public.js: authFailed_, safeEqual_, jsonRoute_, doGet).
// Ejecutar:  node tests/test_auth_key.js     (código real; la hoja y las utilidades de Google son simuladas)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'svc_cleaning.js', 'svc_followups.js', 'tools_backfill.js'];

function entorno() {
  const store = new Map(), props = new Map(), sheets = {};
  const log = { sleeps: [], html: 0 };
  const mkSheet = () => {
    const rows = [];
    return {
      rows, getMaxRows: () => 1000, getLastRow: () => rows.length, appendRow: r => rows.push(r), deleteRow: n => rows.splice(n - 1, 1),
      getRange: (r, c, nr, nc) => ({
        setNumberFormat() {},
        getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
        setValues: v => v.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((val, j) => { rows[r - 1 + i][c - 1 + j] = val; }); })
      })
    };
  };
  const ctx = {
    console: { log() {}, error() {}, warn() {} }, Date,
    CacheService: { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v), remove: k => store.delete(k) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => 'id-' + store.size, formatDate: () => '2026-11-13', sleep: ms => log.sleeps.push(ms) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mkSheet()) }) },
    ContentService: { MimeType: { JAVASCRIPT: 'js', JSON: 'json', TEXT: 'text' }, createTextOutput: t => ({ text: t, mime: null, setMimeType(m) { this.mime = m; return this; } }) },
    HtmlService: { createTemplateFromFile: () => { log.html++; return { evaluate() { return { setTitle() { return this; }, setXFrameOptionsMode() { return this; } }; } }; }, XFrameOptionsMode: { ALLOWALL: 1 } }
  };
  vm.createContext(ctx);
  vm.runInContext(FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'), ctx);
  vm.runInContext('ensureSheets_ = function () {};', ctx);
  return { run: c => vm.runInContext(c, ctx), props, log };
}

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const ROUTES = ['bootstrap', 'initialize', 'updates', 'monthly-goal', 'monthly-history', 'sales-tips', 'airtable-kpi', 'refresh-airtable-kpi',
  'refresh-reviews', 'notes-list', 'notes-add', 'notes-edit', 'notes-delete', 'waitlist-list', 'waitlist-add', 'waitlist-update', 'waitlist-delete',
  'cleaning-list', 'cleaning-add', 'cleaning-delete', 'followups-list', 'followups-add', 'followups-update', 'followups-delete', 'auth-check'];

const t = entorno();
const ruta = (route, params = {}) => JSON.parse(t.run(`jsonRoute_(${JSON.stringify(route)}, null, ${JSON.stringify(params)})`).text);

// Sin clave configurada: abierto (así se puede publicar sin cortar a nadie)
check('sin APP_KEY configurada la API sigue abierta', ruta('followups-list').error !== 'unauthorized' && Array.isArray(ruta('followups-list')));
check('auth-check responde ok sin clave configurada', ruta('auth-check').ok === true);

// Con clave
t.props.set('APP_KEY', 'una-clave-larga-123');
check('sin clave: unauthorized', ruta('followups-list').error === 'unauthorized');
check('sin clave el rechazo es inmediato (no se duerme)', t.log.sleeps.length === 0, t.log.sleeps);
check('clave vacía: unauthorized', ruta('followups-list', { key: '' }).error === 'unauthorized');
check('clave equivocada: unauthorized y tarda 1 s', ruta('followups-list', { key: 'otra' }).error === 'unauthorized' && t.log.sleeps.join() === '1000', t.log.sleeps);
check('clave casi correcta (una letra menos): unauthorized', ruta('followups-list', { key: 'una-clave-larga-12' }).error === 'unauthorized');
check('clave con letras de más: unauthorized', ruta('followups-list', { key: 'una-clave-larga-1234' }).error === 'unauthorized');
check('mayúsculas distintas: unauthorized', ruta('followups-list', { key: 'UNA-CLAVE-LARGA-123' }).error === 'unauthorized');
check('clave correcta: entra', Array.isArray(ruta('followups-list', { key: 'una-clave-larga-123' })));
check('auth-check con clave correcta: ok', ruta('auth-check', { key: 'una-clave-larga-123' }).ok === true);
check('auth-check con clave mala: unauthorized', ruta('auth-check', { key: 'mala' }).error === 'unauthorized');

// Ninguna ruta se salva (ni de lectura ni de escritura)
const sinClave = ROUTES.map(r => [r, ruta(r).error]);
check('TODAS las rutas rechazan una petición sin clave', sinClave.every(([, e]) => e === 'unauthorized'), sinClave.filter(([, e]) => e !== 'unauthorized'));
const mala = ROUTES.map(r => [r, ruta(r, { key: 'x' }).error]);
check('TODAS las rutas rechazan una clave mala', mala.every(([, e]) => e === 'unauthorized'), mala.filter(([, e]) => e !== 'unauthorized'));
check('una ruta que no existe también pide la clave (no revela nada)', ruta('no-existe').error === 'unauthorized' && ruta('no-existe', { key: 'una-clave-larga-123' }).error.startsWith('Ruta no encontrada'));

// Las escrituras sin clave no llegan a ejecutarse
ruta('followups-add', { name: 'INTRUSO', due: '2027-01-01', clientId: 'a1' });
check('un alta sin clave no escribe nada', ruta('followups-list', { key: 'una-clave-larga-123' }).length === 0);
ruta('followups-add', { name: 'CLIENTE', due: '2027-01-01', clientId: 'a2', key: 'una-clave-larga-123' });
const lista = ruta('followups-list', { key: 'una-clave-larga-123' });
check('un alta con clave sí escribe', lista.length === 1 && lista[0].name === 'CLIENTE');
ruta('followups-delete', { id: lista[0].id });
check('un borrado sin clave no borra nada', ruta('followups-list', { key: 'una-clave-larga-123' }).length === 1);

// La antigua pantalla de Google (puerta trasera vía google.script.run) ya no se sirve
const sinRuta = t.run('doGet({ parameter: {} })');
check('doGet sin ruta ya no sirve la pantalla HTML antigua', t.log.html === 0 && sinRuta.text === 'GlowMetrics API', { html: t.log.html, text: sinRuta.text });
check('doGet sin parámetros tampoco', t.run('doGet({})').text === 'GlowMetrics API' && t.log.html === 0);
check('doGet con ruta sigue funcionando (con clave)', JSON.parse(t.run(`doGet({ parameter: { route: 'followups-list', key: 'una-clave-larga-123' } })`).text).length === 1);
check('doGet con ruta y sin clave: unauthorized', JSON.parse(t.run(`doGet({ parameter: { route: 'followups-list' } })`).text).error === 'unauthorized');
check('JSONP: el rechazo también va envuelto en el callback', t.run(`doGet({ parameter: { route: 'followups-list', callback: 'cb' } })`).text === 'cb({"error":"unauthorized"});');

// Comparación
check('safeEqual_: iguales / distintas / distinta longitud / vacías', t.run(`[safeEqual_('abc','abc'), safeEqual_('abc','abd'), safeEqual_('abc','abcd'), safeEqual_('','')]`).join() === 'true,false,false,true');

// Quitar la clave (volver a abrir) también funciona: sirve de marcha atrás
t.props.delete('APP_KEY');
check('si se borra APP_KEY la API vuelve a abrirse (marcha atrás)', Array.isArray(ruta('followups-list')));

console.log(failed ? `\n${failed} FALLOS` : '\nClave de acceso OK');
process.exit(failed ? 1 : 0);
