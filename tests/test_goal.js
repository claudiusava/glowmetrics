// Objetivo mensual por mes: 20 hasta octubre de 2026, 25 desde noviembre de 2026,
// y los meses pasados se siguen evaluando con el objetivo que tenían.
// Ejecutar:  node tests/test_goal.js     (usa el código real de cfg_config.js y api_public.js)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['cfg_config.js', 'api_public.js', 'svc_cache.js', 'svc_airtable.js', 'svc_sheets.js',
  'logic_reviews.js', 'svc_notes.js', 'svc_waitlist.js', 'tools_backfill.js'];

const CUENTAS = {
  '2025-11': 25, '2025-12': 18, '2026-01': 25, '2026-02': 25, '2026-03': 25, '2026-04': 30,
  '2026-05': 24, '2026-06': 25, '2026-07': 34, '2026-08': 22, '2026-09': 22, '2026-10': 26, '2026-11': 24
};

function entorno(fechaIso, cuentas) {
  const store = new Map(), props = new Map();
  const T = Date.parse(fechaIso);
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(T); else super(...a); }
    static now() { return T; }
  }
  const ctx = {
    console: { log() {}, error() {}, warn() {} }, // los avisos de hojas no simuladas (bootstrap) no importan aquí
    Date: FakeDate,
    CacheService: { getScriptCache: () => ({ get: k => store.get(k) ?? null, put: (k, v) => store.set(k, v), remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {}, ContentService: {}, HtmlService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n'), ctx);
  props.set('MONTH_COUNTS', JSON.stringify(cuentas));
  return { run: c => vm.runInContext(c, ctx), store, props };
}

// Solo los meses anteriores al indicado (el entorno "no conoce" el futuro)
const hasta = (mk) => Object.fromEntries(Object.entries(CUENTAS).filter(([k]) => k <= mk));

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

// Tabla de objetivos
const t = entorno('2026-10-26T12:00:00Z', hasta('2026-10'));
const g = m => t.run(`goalForMonth_('${m}')`);
check('antes de noviembre de 2026: 20', g('2025-01') === 20 && g('2026-09') === 20 && g('2026-10') === 20, [g('2025-01'), g('2026-10')]);
check('desde noviembre de 2026: 25', g('2026-11') === 25 && g('2026-12') === 25 && g('2027-06') === 25, [g('2026-11'), g('2027-06')]);

// Octubre (mes en curso): sigue en 20, el "objetivo cumplido" no cambia
const oct = t.run('getMonthlyReviewCount()');
check('octubre: objetivo 20, 26 reseñas (cumplido)', oct.goal === 20 && oct.count === 26 && oct.monthKey === '2026-10', oct);
const histOct = t.run('getMonthlyHistory()');
check('histórico en octubre: 11 meses cerrados, todos con objetivo 20', histOct.length === 11 && histOct.every(h => h.goal === 20), histOct.map(h => h.goal));
check('histórico en octubre: solo diciembre sin cumplir', histOct.filter(h => !h.met).map(h => h.monthKey).join() === '2025-12', histOct.filter(h => !h.met));

// bootstrap (lo que carga la pantalla) trae el objetivo y el histórico
const boot = entorno('2026-10-26T12:00:00Z', hasta('2026-10')).run('getBootstrap()');
check('bootstrap en octubre: objetivo 20 e histórico de 11 meses', boot.goal && boot.goal.goal === 20 && boot.history && boot.history.length === 11, boot.goal);

// 1 de noviembre: objetivo nuevo, contador a 0 y octubre sigue evaluado con 20
const n1 = entorno('2026-11-01T12:00:00Z', hasta('2026-10'));
const nov = n1.run('getMonthlyReviewCount()');
check('1 de noviembre: objetivo 25 y 0 reseñas', nov.goal === 25 && nov.count === 0 && nov.monthKey === '2026-11', nov);
const histNov = n1.run('getMonthlyHistory()');
const octH = histNov.find(h => h.monthKey === '2026-10');
const sepH = histNov.find(h => h.monthKey === '2026-09');
check('histórico en noviembre: octubre (26) y septiembre (22) siguen cumplidos con objetivo 20', octH.goal === 20 && octH.met === true && sepH.goal === 20 && sepH.met === true, [octH, sepH]);

// Mitad de noviembre: se ve el avance contra 25
const n2 = entorno('2026-11-15T12:00:00Z', hasta('2026-11'));
const nov15 = n2.run('getMonthlyReviewCount()');
check('mitad de noviembre: 24 de 25 (aún sin cumplir)', nov15.goal === 25 && nov15.count === 24, nov15);

// Diciembre: noviembre (24) se evalúa con 25 y no se cumple; octubre sigue cumplido
const d1 = entorno('2026-12-01T12:00:00Z', hasta('2026-11'));
const histDic = d1.run('getMonthlyHistory()');
const novH = histDic.find(h => h.monthKey === '2026-11');
check('histórico en diciembre: noviembre (24) se evalúa con 25 -> no cumplido', novH.goal === 25 && novH.met === false && novH.count === 24, novH);
check('histórico en diciembre: octubre (26) sigue cumplido con 20', histDic.find(h => h.monthKey === '2026-10').met === true);

// La copia guardada lleva su mes: el objetivo de octubre no se arrastra a noviembre
const c = entorno('2026-10-31T12:00:00Z', hasta('2026-10'));
c.run('getMonthlyReviewCount()');
const copia = JSON.parse([...c.store.entries()].find(([k]) => k.includes('goal'))[1]);
check('la copia del objetivo lleva el mes y el objetivo de octubre', copia.monthKey === '2026-10' && copia.goal === 20, copia);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nObjetivo por mes OK');
process.exit(failed ? 1 : 0);
