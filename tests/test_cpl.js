// Coste de publicidad por lead y por cita (con y sin IVA), con leads de los últimos 30 días.
// Ejecutar:  node tests/test_cpl.js     (usa el código real de svc_airtable.js; Airtable y las hojas son simulados)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'tools_backfill.js', 'triggers_airtable.js'];

const AHORA = Date.parse('2026-10-27T12:00:00Z');
const dias = n => new Date(AHORA - n * 24 * 3600 * 1000).toISOString();

// Leads simulados (createdTime + estado). Ventana = últimos 30 días.
const REGISTROS = [
  { createdTime: dias(1), fields: { 'Field 5': 'CITADA' } },                 // dentro
  { createdTime: dias(5), fields: { 'Field 5': 'NO' } },                     // dentro
  { createdTime: dias(10), fields: { 'Field 5': 'CITADA' } },                // dentro
  { createdTime: dias(29), fields: { 'Field 5': 'CITADA' } },                // dentro
  { createdTime: dias(29.9), fields: { 'Field 5': 'VOLVER A LLAMAR' } },     // dentro
  { createdTime: dias(1), fields: { 'Field 5': { name: 'CITADA' } } },       // dentro (campo de tipo "selección")
  { createdTime: dias(31), fields: { 'Field 5': 'CITADA' } },                // fuera
  { createdTime: dias(60), fields: { 'Field 5': 'NO' } },                    // fuera
  { createdTime: dias(100), fields: { 'Field 5': 'CITADA' } },               // fuera
  { fields: { 'Field 5': 'NO' } }                                            // sin fecha: cuenta en el total, no en la ventana
];

function entorno() {
  const store = new Map(), props = new Map([['AIRTABLE_PAT', 'pat_falso']]);
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(AHORA); else super(...a); }
    static now() { return AHORA; }
  }
  const filas = []; // hoja AirtableKpi simulada (cabecera + datos)
  const hoja = {
    getLastRow: () => filas.length,
    getRange: (r, c, nr, nc) => ({
      setValues: v => v.forEach((fila, i) => { filas[r - 1 + i] = fila.slice(); }),
      getValues: () => filas.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc))
    })
  };
  let llamadas = 0;
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    Date: FakeDate,
    CacheService: { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v), remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => (filas.length ? hoja : null), insertSheet: () => hoja }) },
    // Airtable en dos páginas (6 + 4 registros)
    UrlFetchApp: { fetch: url => {
      llamadas++;
      const segunda = url.indexOf('offset=') !== -1;
      const records = segunda ? REGISTROS.slice(6) : REGISTROS.slice(0, 6);
      const body = JSON.stringify(segunda ? { records } : { records, offset: 'pagina2' });
      return { getResponseCode: () => 200, getContentText: () => body };
    } },
    ContentService: {}, HtmlService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'), ctx);
  return { run: c => vm.runInContext(c, ctx), props, llamadas: () => llamadas };
}

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

// --- Cálculo del coste ---
const e = entorno();
const c = e.run('adCost_(67, 26)');
check('gasto 750 € y con IVA 907,50 €', c.spend === 750 && c.spendVat === 907.5, c);
check('67 leads: 11,19 € por lead (13,54 € con IVA)', c.perLead === 11.19 && c.perLeadVat === 13.54, c);
check('26 citadas: 28,85 € por cita (34,90 € con IVA)', c.perCita === 28.85 && c.perCitaVat === 34.9, c);
check('la ventana es de 30 días', c.windowDays === 30);
const cero = e.run('adCost_(0, 0)');
check('sin leads ni citadas: costes null (no hay división por cero)', cero.perLead === null && cero.perCita === null && cero.perLeadVat === null && cero.perCitaVat === null, cero);
const sinCitas = e.run('adCost_(20, 0)');
check('con leads pero sin citadas: por lead sí, por cita null', sinCitas.perLead === 37.5 && sinCitas.perCita === null, sinCitas);

// --- Lectura de Airtable: ventana de 30 días por fecha de creación ---
const stats = e.run('getAirtableStats()');
check('total 10 y 6 citadas (60 %)', stats.total === 10 && stats.citadas === 6 && stats.pct === 60, stats);
check('ventana: 6 leads y 4 citadas (el de 29,9 días entra; el de 31 no; el sin fecha no)', stats.leadsVentana === 6 && stats.citadasVentana === 4, stats);
check('se leen las 2 páginas de Airtable', e.llamadas() === 2, e.llamadas());

// --- De punta a punta: job -> snapshot -> KPI con coste ---
e.run('airtableKpiJob()');
const kpi = e.run('getAirtablePercentage()');
check('el KPI sigue trayendo porcentaje y totales', kpi.pct === 60 && kpi.total === 10 && kpi.citadas === 6, kpi);
check('el KPI trae el coste de la ventana', kpi.cost && kpi.cost.leads === 6 && kpi.cost.citadas === 4, kpi.cost);
check('coste por lead = 750/6 = 125 € (151,25 € con IVA)', kpi.cost.perLead === 125 && kpi.cost.perLeadVat === 151.25, kpi.cost);
check('coste por cita = 750/4 = 187,50 € (226,88 € con IVA)', kpi.cost.perCita === 187.5 && kpi.cost.perCitaVat === 226.88, kpi.cost);
const boot = e.run('getBootstrap()');
check('bootstrap también lleva el coste', boot.kpi && boot.kpi.cost && boot.kpi.cost.leads === 6, boot.kpi);

// --- Sin datos de ventana todavía (primer despliegue): el KPI funciona igual, sin coste ---
const e2 = entorno();
e2.run('saveAirtableSnapshot_("ALCORCON", { pct: 36.5, total: 717, citadas: 261 })'); // snapshot "antiguo", sin ventana
const antiguo = e2.run('getAirtablePercentage()');
check('snapshot antiguo: KPI correcto y sin campo de coste', antiguo.pct === 36.5 && antiguo.total === 717 && antiguo.cost === undefined, antiguo);

// --- Un fallo de Airtable no borra el último coste bueno ---
e.run('saveAirtableSnapshot_("ALCORCON", { pct: 32.15, total: 0, citadas: 0 })'); // snapshot de emergencia (sin ventana)
const trasFallo = e.run('getAirtablePercentage()');
check('snapshot de emergencia: se conserva el último coste calculado', trasFallo.cost && trasFallo.cost.leads === 6, trasFallo.cost);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nCoste por lead OK');
process.exit(failed ? 1 : 0);
