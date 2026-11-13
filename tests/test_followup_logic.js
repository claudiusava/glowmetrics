// Lógica de los repasos de clientas (followup-logic.ts).
// Ejecutar desde la carpeta frontend:  NODE_PATH=$(pwd)/node_modules node ../tests/test_followup_logic.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '../frontend/src/app/components');
const load = (file, deps = {}) => {
  const src = fs.readFileSync(path.join(base, file), 'utf8');
  const m = { exports: {} };
  const req = p => (p in deps ? deps[p] : require(p));
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText)(m, m.exports, req);
  return m.exports;
};
const cleaning = load('cleaning-board/cleaning-logic.ts');
const { addMonths, addDays, PRESETS, presetDate, followupState, dueNow, sortFollowups, fmtDay, SOON_DAYS } =load('followup-board/followup-logic.ts', { '../cleaning-board/cleaning-logic': cleaning });

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const hoy = '2026-11-13';
const F = (id, due, createdAt = '2026-01-01T10:00:00Z') => ({ id, name: 'Clienta ' + id, due, note: '', createdAt });

// Sumar meses
check('+6 meses', addMonths('2026-11-13', 6) === '2027-05-13');
check('+12 meses', addMonths('2026-11-13', 12) === '2027-11-13');
check('cruza el año', addMonths('2026-11-13', 3) === '2027-02-13');
check('31 de agosto + 6 meses = 28 de febrero (el mes no tiene 31)', addMonths('2026-08-31', 6) === '2027-02-28');
check('29 de febrero + 12 meses = 28 de febrero (año no bisiesto)', addMonths('2028-02-29', 12) === '2029-02-28');
check('29 de febrero + 48 meses = 29 de febrero (bisiesto)', addMonths('2028-02-29', 48) === '2032-02-29');
check('+0 meses es la misma fecha', addMonths('2026-11-13', 0) === '2026-11-13');

// Sumar días y atajos (se cuentan desde hoy)
check('+14 días', addDays('2026-11-13', 14) === '2026-11-27');
check('+14 días cruza el mes y el año', addDays('2026-12-25', 14) === '2027-01-08');
check('+0 días y +365 días', addDays('2026-11-13', 0) === '2026-11-13' && addDays('2026-11-13', 365) === '2027-11-13');
check('+1 día en 28 de febrero (año no bisiesto)', addDays('2027-02-28', 1) === '2027-03-01');
check('atajos: 2 semanas, 1 mes, 6 meses, 1 año', PRESETS.map(p => p.label).join('|') === 'En 2 semanas|En 1 mes|En 6 meses|En 1 año');
check('fechas de los atajos desde el 13/11/2026', PRESETS.map(p => presetDate(p, '2026-11-13')).join() === '2026-11-27,2026-12-13,2027-05-13,2027-11-13', PRESETS.map(p => presetDate(p, '2026-11-13')));
check('1 mes desde el 31 de enero = 28 de febrero', presetDate({ label: 'x', months: 1 }, '2027-01-31') === '2027-02-28');

// Estado
const st =d => followupState(F('x', d), hoy);
check('hoy: nivel "today"', st('2026-11-13').level === 'today' && st('2026-11-13').text === 'Hoy' && st('2026-11-13').days === 0);
check('ayer: atrasado 1 día', st('2026-11-12').level === 'late' && st('2026-11-12').text === 'Atrasado 1 día', st('2026-11-12'));
check('hace 5 días: atrasado 5 días', st('2026-11-08').text === 'Atrasado 5 días' && st('2026-11-08').days === -5);
check('mañana: "se acerca"', st('2026-11-14').level === 'soon' && st('2026-11-14').text === 'Mañana');
check('en 6 días', st('2026-11-19').text === 'En 6 días' && st('2026-11-19').level === 'soon');
check('en 14 días: aún "se acerca", dicho en semanas', st('2026-11-27').level === 'soon' && st('2026-11-27').text === 'En 2 semanas', st('2026-11-27'));
check('en 15 días: ya no se acerca', st('2026-11-28').level === 'later' && SOON_DAYS === 14);
check('en 5 semanas', st('2026-12-18').text === 'En 5 semanas', st('2026-12-18'));
check('en 6 meses', st('2027-05-13').text === 'En 6 meses', st('2027-05-13'));
check('en 1 año = 12 meses', st('2027-11-13').text === 'En 12 meses', st('2027-11-13'));
check('en 2 meses (62 días)', st('2027-01-14').text === 'En 2 meses', st('2027-01-14'));

// Avisos
const lista = [F('a', '2026-11-13'), F('b', '2026-10-01'), F('c', '2026-11-14'), F('d', '2027-05-01')];
check('tocan hoy y los atrasados, no los de mañana', dueNow(lista, hoy).map(f => f.id).sort().join() === 'a,b', dueNow(lista, hoy));
check('sin repasos, nada que avisar', dueNow([], hoy).length === 0);
check('a medianoche se enciende el del día siguiente', dueNow(lista, '2026-11-14').map(f => f.id).sort().join() === 'a,b,c');

// Orden
check('orden: el que antes toca primero', sortFollowups(lista).map(f => f.id).join() === 'b,a,c,d');
check('a igual fecha, el apuntado antes', sortFollowups([F('n', '2026-11-13', '2026-05-02T00:00:00Z'), F('m', '2026-11-13', '2026-05-01T00:00:00Z')]).map(f => f.id).join() === 'm,n');
check('ordenar no cambia la lista original', lista[0].id === 'a');

check('fecha legible', fmtDay('2027-03-05') === '5 mar 2027' && fmtDay('2026-12-25') === '25 dic 2026');

console.log(failed ? `\n${failed} FALLOS` : '\nTodo bien');
process.exit(failed ? 1 : 0);
