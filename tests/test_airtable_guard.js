// Red de seguridad del KPI de Airtable: una lectura con muchos menos leads que la guardada (p. ej. con un filtro
// puesto en la vista) no se guarda. Ejecutar:  node tests/test_airtable_guard.js   (Airtable y las hojas son simulados)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'tools_backfill.js', 'triggers_airtable.js'];

function entorno() {
  const store = new Map(), props = new Map([['AIRTABLE_PAT', 'pat_falso']]);
  const filas = [];
  const hoja = {
    getLastRow: () => filas.length,
    getRange: (r, c, nr, nc) => ({
      setValues: v => v.forEach((fila, i) => { filas[r - 1 + i] = fila.slice(); }),
      getValues: () => filas.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc))
    })
  };
  let airtable = { total: 0, citadas: 0 }; // lo que "devuelve" Airtable ahora mismo
  let llamadas = 0;
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    CacheService: { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v), remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => (filas.length ? hoja : null), insertSheet: () => hoja }) },
    UrlFetchApp: { fetch: () => {
      llamadas++;
      const records = [];
      for (let i = 0; i < airtable.total; i++) records.push({ createdTime: '2020-01-01T00:00:00Z', fields: { 'Field 5': i < airtable.citadas ? 'CITADA' : 'NO' } });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ records }) };
    } },
    ContentService: {}, HtmlService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'), ctx);
  return { run: c => vm.runInContext(c, ctx), setAirtable: a => { airtable = a; }, llamadas: () => llamadas };
}

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

// --- La regla ---
const e = entorno();
const mala = (prev, total) => e.run(`readingLooksWrong_(${JSON.stringify(prev)}, { total: ${total} })`);
const prev = { total: 717, citadas: 261 };
check('con un filtro (208 de 717) la lectura se descarta', mala(prev, 208) === true);
check('si el total sube, se acepta', mala(prev, 730) === false);
check('si el total es igual, se acepta', mala(prev, 717) === false);
check('una bajada pequeña (<10 %) se acepta', mala(prev, 660) === false);
check('una bajada de más del 10 % se descarta (645,3 es el límite)', mala(prev, 646) === false && mala(prev, 645) === true);
check('sin snapshot previo se acepta', mala(null, 0) === false);
check('con referencia muy pequeña (<50 leads) se acepta', mala({ total: 30, citadas: 10 }, 5) === false);
check('el snapshot de emergencia (total 0) no bloquea nada', mala({ total: 0, citadas: 0 }, 717) === false);

// --- De punta a punta: el job ---
const j = entorno();
j.setAirtable({ total: 717, citadas: 261 });
j.run('airtableKpiJob()');
let kpi = j.run('getAirtablePercentage()');
check('primera lectura buena: se guarda (36,4 %)', kpi.total === 717 && kpi.citadas === 261 && Math.abs(kpi.pct - 36.4) < 0.1, kpi);
const costeBueno = JSON.stringify(kpi.cost);

j.setAirtable({ total: 208, citadas: 0 }); // alguien tiene un filtro en la vista
j.run('airtableKpiJob()');
kpi = j.run('getAirtablePercentage()');
check('lectura con filtro: se conserva el dato anterior (717 y 261)', kpi.total === 717 && kpi.citadas === 261, kpi);
check('y el coste tampoco se estropea', JSON.stringify(kpi.cost) === costeBueno, kpi.cost);

j.setAirtable({ total: 725, citadas: 265 }); // sin filtro y con leads nuevos
j.run('airtableKpiJob()');
kpi = j.run('getAirtablePercentage()');
check('cuando la lectura vuelve a ser buena, se guarda', kpi.total === 725 && kpi.citadas === 265, kpi);

// --- Refresco manual (palabra secreta "airtable") ---
const m = entorno();
m.setAirtable({ total: 717, citadas: 261 });
m.run('airtableKpiJob()');
m.run('PropertiesService.getScriptProperties().setProperty("CD_manual_airtable_refresh", "0")');
m.setAirtable({ total: 208, citadas: 0 });
let r = m.run('manualRefreshAirtableKpi()');
check('manual con filtro: avisa de que se descartó y devuelve el dato anterior', r.rejected === true && r.refreshed === false && r.total === 717, r);

m.run('PropertiesService.getScriptProperties().setProperty("CD_manual_airtable_refresh", "0")');
m.setAirtable({ total: 720, citadas: 262 });
r = m.run('manualRefreshAirtableKpi()');
check('manual sin filtro: se guarda y no hay descarte', r.rejected === false && r.refreshed === true && r.total === 720, r);

// --- La lectura mala no se queda en la caché de 15 minutos ---
const c = entorno();
c.setAirtable({ total: 717, citadas: 261 });
c.run('airtableKpiJob()');
c.setAirtable({ total: 208, citadas: 0 });
c.run('airtableKpiJob()');
c.setAirtable({ total: 717, citadas: 262 });
const cached = c.run('getAirtableStats()');
check('tras una lectura descartada, la siguiente vuelve a leer Airtable (no usa la mala)', cached.total === 717, cached);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nRed de seguridad OK');
process.exit(failed ? 1 : 0);
