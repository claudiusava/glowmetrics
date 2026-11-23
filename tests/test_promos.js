// Ofertas con unidades limitadas (svc_promos.js). Ejecutar:  node tests/test_promos.js
// Usa el código real; la hoja y las utilidades de Google son simuladas.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'svc_cleaning.js', 'svc_followups.js', 'svc_promos.js', 'tools_backfill.js'];

function entorno() {
  const store = new Map(), props = new Map();
  const sheets = {};
  const log = { inserted: [], numberFormat: [] };
  const mkSheet = name => {
    const rows = [];
    return {
      rows,
      getMaxRows: () => 1000,
      getLastRow: () => rows.length,
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
    Date,
    CacheService: { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v), remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => 'id-' + (++uuid), formatDate: d => d.toISOString().slice(0, 10) },
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
  return { run: c => vm.runInContext(c, ctx), sheets, log, store, ctx };
}

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const t = entorno();
const ofertas = t.run('PROMO_OFFERS');
const lim = id => ofertas.find(o => o.id === id).limit;
const sell = (id, cid) => t.run(`changePromo_('sell', ${JSON.stringify(id)}, ${JSON.stringify(cid)})`);
const undo = (id, cid) => t.run(`changePromo_('undo', ${JSON.stringify(id)}, ${JSON.stringify(cid)})`);
const set = (id, n, cid) => t.run(`changePromo_('set', ${JSON.stringify(id)}, ${JSON.stringify(cid)}, ${JSON.stringify(n)})`);

// ---- Configuración: lo que dicen los carteles de la franquicia ----
check('hay 27 ofertas con id distinto', ofertas.length === 27 && new Set(ofertas.map(o => o.id)).size === 27, ofertas.length);
const porSeccion = s => ofertas.filter(o => o.section === s);
check('9 de mujer, 9 de hombre, y las de 3 €, 2 € y 1 €: 6 de mujer y 3 de hombre', porSeccion('mujer').length === 9 && porSeccion('hombre').length === 9 && porSeccion('minis-mujer').length === 6 && porSeccion('minis-hombre').length === 3);
check('cuerpo completo mujer: 15, 20 y 50 unidades (3, 2 y 1 sesiones)', [lim('mujer-cuerpo-3'), lim('mujer-cuerpo-2'), lim('mujer-cuerpo-1')].join() === '15,20,50');
check('cuerpo completo hombre: 15, 25 y 50 unidades', [lim('hombre-cuerpo-3'), lim('hombre-cuerpo-2'), lim('hombre-cuerpo-1')].join() === '15,25,50');
check('el resto de packs de mujer y hombre: 50 unidades', ofertas.filter(o => !o.section.startsWith('minis') && !o.id.includes('cuerpo')).every(o => o.limit === 50));
check('las de 3 €, 2 € y 1 €: 25 unidades de CADA precio', ofertas.filter(o => o.section.startsWith('minis')).every(o => o.limit === 25));
check('precio de algunas de la tabla: cuerpo mujer 3 sesiones 195 €, piernas hombre 1 sesión 24,90 €', ofertas.find(o => o.id === 'mujer-cuerpo-3').price === '195 €' && ofertas.find(o => o.id === 'hombre-piernas-1').price === '24,90 €');

// ---- Ofertas cerradas (agotadas por la franquicia): las de axilas e ingles a 1 € ----
const cerradas = ofertas.filter(o => o.closed).map(o => o.id).sort();
check('cerradas: ingles 1 € mujer, axilas 1 € mujer y axilas 1 € hombre (y ninguna más)', cerradas.join() === 'mini-hombre-axilas-1,mini-mujer-axilas-1,mini-mujer-ingles-1', cerradas);

// ---- Hoja ----
const lista = t.run('getPromos()');
check('la hoja Ofertas se crea sola con una fila por oferta, todas a 0', t.log.inserted.includes('Ofertas') && t.sheets.Ofertas.rows.length === 28 && t.sheets.Ofertas.rows[0].join() === 'offer,sold,updatedAt');
check('getPromos devuelve campaña, ofertas y vendidas (todo a 0)', lista.campaign.name === 'Black Friday' && lista.offers.length === 27 && Object.keys(lista.sold).length === 27 && Object.values(lista.sold).every(v => v === 0));

// ---- Vender ----
let r = sell('mini-mujer-axilas-3', 'a1');
check('vender una: queda 1 vendida y el resto a 0', r.ok && r.counts['mini-mujer-axilas-3'] === 1 && Object.entries(r.counts).filter(([k, v]) => v !== 0).length === 1, r);
r = sell('mini-mujer-axilas-3', 'a2');
check('vender otra: 2', r.counts['mini-mujer-axilas-3'] === 2);
r = sell('mini-mujer-axilas-3', 'a2');
check('el mismo clientId no cuenta dos veces (reintento tras un atasco)', r.ok && r.counts['mini-mujer-axilas-3'] === 2 && t.run('getPromos()').sold['mini-mujer-axilas-3'] === 2, r);
check('cada oferta lleva su propia cuenta', sell('mini-mujer-axilas-2', 'a3').counts['mini-mujer-axilas-2'] === 1 && t.run('getPromos()').sold['mini-mujer-axilas-3'] === 2);
check('lo vendido se guarda en una sola fila por oferta (no crece la hoja)', t.sheets.Ofertas.rows.length === 28);

// ---- Límite ----
for (let i = 0; i < lim('mujer-cuerpo-3'); i++) sell('mujer-cuerpo-3', 'c' + i);
check('se pueden vender las 15 de cuerpo completo mujer 3 sesiones', t.run('getPromos()').sold['mujer-cuerpo-3'] === 15);
r = sell('mujer-cuerpo-3', 'c-extra');
check('la 16.ª se rechaza (agotada) y no se cuenta', r.error === 'sold-out' && r.counts['mujer-cuerpo-3'] === 15 && t.run('getPromos()').sold['mujer-cuerpo-3'] === 15, r);
r = sell('mujer-cuerpo-3', 'c-extra');
check('reintentar una venta rechazada sigue rechazándose (no se "aprende" como hecha)', r.error === 'sold-out');
check('agotar una no afecta a las demás', sell('mujer-cuerpo-2', 'd1').ok === true);

// ---- Deshacer ----
r = undo('mujer-cuerpo-3', 'u1');
check('deshacer devuelve una unidad (14) y se puede volver a vender', r.ok && r.counts['mujer-cuerpo-3'] === 14 && sell('mujer-cuerpo-3', 'c-otra').counts['mujer-cuerpo-3'] === 15);
undo('mujer-cuerpo-3', 'u2');
r = undo('mujer-cuerpo-3', 'u2');
check('deshacer con el mismo clientId no resta dos veces', r.ok && r.counts['mujer-cuerpo-3'] === 14, r);
r = undo('hombre-piernas-1', 'u3');
check('deshacer sin ventas: error y sigue en 0 (nunca negativo)', r.error === 'nothing-to-undo' && r.counts['hombre-piernas-1'] === 0, r);

// ---- Ajustar ----
r = set('hombre-cuerpo-3', 7, 's1');
check('ajustar: pone el número exacto', r.ok && r.counts['hombre-cuerpo-3'] === 7, r);
check('ajustar dos veces igual da lo mismo', set('hombre-cuerpo-3', 7, 's1').counts['hombre-cuerpo-3'] === 7 && set('hombre-cuerpo-3', 7, 's2').counts['hombre-cuerpo-3'] === 7);
check('ajustar al límite (15) vale', set('hombre-cuerpo-3', 15, 's3').counts['hombre-cuerpo-3'] === 15);
check('ajustar por encima del límite se rechaza', set('hombre-cuerpo-3', 16, 's4').error === 'invalid-number' && t.run('getPromos()').sold['hombre-cuerpo-3'] === 15);
check('ajustar a negativo, decimal o texto se rechaza', ['-1', '2.5', 'abc', ''].every((v, i) => set('hombre-cuerpo-3', v, 'sx' + i).error === 'invalid-number') && t.run('getPromos()').sold['hombre-cuerpo-3'] === 15);
check('ajustar a 0 vale', set('hombre-cuerpo-3', 0, 's5').counts['hombre-cuerpo-3'] === 0);
check('oferta desconocida', sell('no-existe', 'z1').error === 'unknown-offer' && set('no-existe', 1, 'z2').error === 'unknown-offer');

const rutaTemprana = (route, params) => JSON.parse(t.run(`jsonRoute_(${JSON.stringify(route)}, null, ${JSON.stringify(params || {})})`).text);
// ---- Cerradas: se ve lo vendido, pero no se puede cambiar nada ----
// (se prepara con 7 vendidas escritas directamente en la hoja, como si se hubieran vendido antes de cerrarla)
t.sheets.Ofertas.rows.find(x => x[0] === 'mini-mujer-ingles-1')[1] = '7';
check('una cerrada sigue contando lo que se vendió', t.run('getPromos()').sold['mini-mujer-ingles-1'] === 7 && t.run('getPromos()').offers.find(o => o.id === 'mini-mujer-ingles-1').closed === true);
r = sell('mini-mujer-ingles-1', 'cl1');
check('vender una cerrada se rechaza (closed) y devuelve los números', r.error === 'closed' && r.counts['mini-mujer-ingles-1'] === 7, r);
r = undo('mini-mujer-ingles-1', 'cl2');
check('deshacer una cerrada se rechaza', r.error === 'closed' && t.run('getPromos()').sold['mini-mujer-ingles-1'] === 7, r);
r = set('mini-mujer-ingles-1', 3, 'cl3');
check('ajustar una cerrada se rechaza', r.error === 'closed' && t.run('getPromos()').sold['mini-mujer-ingles-1'] === 7, r);
check('las demás siguen funcionando (la de 2 € de al lado)', sell('mini-mujer-ingles-2', 'cl4').ok === true);
check('ruta promos-sell sobre una cerrada también rechaza', rutaTemprana('promos-sell', { offer: 'mini-hombre-axilas-1', clientId: 'cl5' }).error === 'closed');

// ---- Hoja con una oferta nueva en la configuración (sin fila todavía) y con datos estropeados ----
t.sheets.Ofertas.rows.splice(t.sheets.Ofertas.rows.findIndex(x => x[0] === 'mini-hombre-axilas-3'), 1);
check('una oferta sin fila cuenta como 0 y se puede vender (se crea su fila)', t.run('getPromos()').sold['mini-hombre-axilas-3'] === 0 && sell('mini-hombre-axilas-3', 'n1').counts['mini-hombre-axilas-3'] === 1);
t.sheets.Ofertas.rows.find(x => x[0] === 'mini-hombre-axilas-2')[1] = 'basura';
check('un número roto en la hoja se lee como 0', t.run('getPromos()').sold['mini-hombre-axilas-2'] === 0);

// ---- Rutas ----
const ruta = (route, params) => JSON.parse(t.run(`jsonRoute_(${JSON.stringify(route)}, null, ${JSON.stringify(params || {})})`).text);
check('ruta promos-list', ruta('promos-list').offers.length === 27);
check('ruta promos-sell', ruta('promos-sell', { offer: 'mujer-piernas-3', clientId: 'rt1' }).counts['mujer-piernas-3'] === 1);
check('ruta promos-undo', ruta('promos-undo', { offer: 'mujer-piernas-3', clientId: 'rt2' }).counts['mujer-piernas-3'] === 0);
check('ruta promos-set', ruta('promos-set', { offer: 'mujer-piernas-3', sold: '12', clientId: 'rt3' }).counts['mujer-piernas-3'] === 12);

// ---- Un fallo de lectura nunca se contesta como "0 vendidas" ----
t.run(`SpreadsheetApp.openById = function () { throw new Error('boom'); }; 0`);
t.store.set('promos_sheet_v1', '1');
check('si la hoja no se puede leer: error (la web conserva lo último), no ceros', t.run('getPromos()').error && !t.run('getPromos()').sold);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nOfertas (servidor) OK');
process.exit(failed ? 1 : 0);
