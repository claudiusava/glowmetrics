// Lógica del registro de limpieza (cleaning-logic.ts) con los datos reales del papel.
// Ejecutar desde la carpeta frontend:  NODE_PATH=$(pwd)/node_modules node ../tests/test_cleaning_logic.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '../frontend/src/app/components/cleaning-board/cleaning-logic.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText)(m, m.exports);
const { todayIso, daysBetween, lastEntry, agoText, taskState, suggestWho, normalizeDate, shareStats } = m.exports;

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const E = (task, who, date, note = '', n = 0) => ({ id: task + who + date + n, task, who, date, note, createdAt: date + 'T10:00:00Z' + n });
const TAREAS = {
  recepcion: { id: 'recepcion', name: 'Polvo recepción', icon: '', everyDays: 30 },
  cabina1: { id: 'cabina1', name: 'Polvo cabina 1', icon: '', everyDays: 21 },
  bano: { id: 'bano', name: 'Baño', icon: '', everyDays: 15 },
  cristales: { id: 'cristales', name: 'Cristales', icon: '', everyDays: 60 },
};
const STAFF = ['Elena', 'Laura'];

check('daysBetween: 29/10 - 21/09 = 38 días', daysBetween('2026-09-21', '2026-10-29') === 38);
check('daysBetween cruza el cambio de hora y de año', daysBetween('2025-12-31', '2026-01-02') === 2 && daysBetween('2026-10-24', '2026-10-26') === 2);
check('todayIso en formato AAAA-MM-DD', todayIso(new Date(2026, 0, 5)) === '2026-01-05');
check('textos: hoy, ayer, días, semanas, meses', [0, 1, 5, 21, 70].map(agoText).join('|') === 'Hoy|Ayer|Hace 5 días|Hace 3 semanas|Hace 2 meses', [0, 1, 5, 21, 70].map(agoText));

// Estados de una tarea
const hoy = '2026-10-29';
const sinNada = taskState(TAREAS.bano, [], hoy);
check('sin registros: nivel "none"', sinNada.level === 'none' && sinNada.ago === 'Sin registros');
check('baño hecho hace 5 días (plazo 15): al día', taskState(TAREAS.bano, [E('bano', 'Laura', '2026-10-24')], hoy).level === 'ok');
check('baño hecho hace 15 días: ya toca', taskState(TAREAS.bano, [E('bano', 'Laura', '2026-10-14')], hoy).level === 'due');
check('baño hecho hace 22 días (1,5 veces el plazo es 22,5): sigue "toca"', taskState(TAREAS.bano, [E('bano', 'Laura', '2026-10-07')], hoy).level === 'due');
check('baño hecho hace 23 días: atrasado', taskState(TAREAS.bano, [E('bano', 'Laura', '2026-10-06')], hoy).level === 'late');
check('se usa el apunte MÁS RECIENTE aunque se apuntara antes', taskState(TAREAS.bano, [E('bano', 'Laura', '2026-10-27'), E('bano', 'Elena', '2026-09-01')], hoy).last.who === 'Laura');
check('a igual fecha manda el último que se apuntó', lastEntry([E('bano', 'Laura', '2026-10-27', '', 1), E('bano', 'Elena', '2026-10-27', '', 2)], 'bano').who === 'Elena');
check('una fecha futura (reloj desfasado) no da días negativos', taskState(TAREAS.bano, [E('bano', 'Laura', '2026-11-02')], hoy).days === 0);

// ---------- Papel real (lo leído de la foto, año 2026) ----------
const PAPEL = [
  // Polvo recepción
  E('recepcion', 'Elena', '2026-01-21'), E('recepcion', 'Laura', '2026-01-30'), E('recepcion', 'Elena', '2026-02-11'),
  E('recepcion', 'Laura', '2026-02-17'), E('recepcion', 'Elena', '2026-05-05', 'solo suelo'), E('recepcion', 'Elena', '2026-06-15', 'solo suelo'),
  E('recepcion', 'Elena', '2026-08-04'), E('recepcion', 'Laura', '2026-09-21'),
  // Baño
  E('bano', 'Elena', '2026-01-23'), E('bano', 'Laura', '2026-01-26'), E('bano', 'Elena', '2026-02-12'), E('bano', 'Laura', '2026-02-19'),
  E('bano', 'Laura', '2026-03-23'), E('bano', 'Elena', '2026-05-05'), E('bano', 'Elena', '2026-06-15', 'solo suelo'), E('bano', 'Laura', '2026-06-17'),
  E('bano', 'Laura', '2026-07-17'), E('bano', 'Laura', '2026-08-17'), E('bano', 'Laura', '2026-09-03'), E('bano', 'Laura', '2026-09-21'),
  // Cabina 1 (las limpiezas "de las dos cabinas" cuentan para ambas)
  E('cabina1', 'Elena', '2026-01-20'), E('cabina1', 'Laura', '2026-01-26'), E('cabina1', 'Laura', '2026-02-09'), E('cabina1', 'Laura', '2026-02-17'),
  E('cabina1', 'Laura', '2026-03-23'), E('cabina1', 'Elena', '2026-04-20', 'solo suelo'), E('cabina1', 'Laura', '2026-04-29'), E('cabina1', 'Laura', '2026-05-05'),
  E('cabina1', 'Elena', '2026-05-05'), E('cabina1', 'Elena', '2026-06-22'), E('cabina1', 'Laura', '2026-08-17'), E('cabina1', 'Laura', '2026-09-03'), E('cabina1', 'Laura', '2026-09-21'),
];
const estado = id => taskState(TAREAS[id], PAPEL, hoy);
check('papel: baño, última vez el 21/09 (38 días) -> atrasado', estado('bano').days === 38 && estado('bano').level === 'late' && estado('bano').last.who === 'Laura');
check('papel: recepción, última vez el 21/09 (38 días, plazo 30) -> toca, aún no atrasada (45)', estado('recepcion').level === 'due');
check('papel: cabina 1, última vez el 21/09 -> atrasada (plazo 21)', estado('cabina1').level === 'late');
check('papel: cristales no tiene registros', estado('cristales').level === 'none');

// ---------- A quién le toca ----------
// Últimos 90 días (desde el 31/07): Elena 1 (4/8), Laura 7 (17/8 x2, 3/9 x2, 21/9 x3 sin contar cabina 2) -> toca a Elena
const reparto = { Elena: 50, Laura: 50 };
check('papel, partes iguales: le toca a Elena (casi todo lo reciente lo ha hecho Laura)', suggestWho(PAPEL, STAFF, reparto, 'bano', hoy) === 'Elena');
check('si Elena trabajara más horas (65 %), también le toca a Elena', suggestWho(PAPEL, STAFF, { Elena: 65, Laura: 35 }, 'bano', hoy) === 'Elena');
check('si Laura tuviera el 95 % del reparto, le tocaría a Laura (aunque haga mucho)', suggestWho(PAPEL, STAFF, { Elena: 5, Laura: 95 }, 'bano', hoy) === 'Laura');
check('sin apuntes y a partes iguales: nadie ha hecho esa tarea -> empate sin sugerencia', suggestWho([], STAFF, reparto, 'bano', hoy) === null);
check('empate en el reparto: le toca a quien lleve más tiempo sin esa tarea',
  suggestWho([E('bano', 'Elena', '2026-10-01'), E('bano', 'Laura', '2026-10-10')], STAFF, reparto, 'bano', hoy) === 'Elena');
check('solo cuentan los últimos 90 días (lo anterior no pesa)',
  suggestWho([E('bano', 'Laura', '2026-01-01'), E('bano', 'Laura', '2026-01-02'), E('bano', 'Elena', '2026-10-20')], STAFF, reparto, 'bano', hoy) === 'Laura');
check('personas fuera de la lista no cuentan', suggestWho([E('bano', 'Paco', '2026-10-20')], STAFF, reparto, 'bano', hoy) === null);

// ---------- Fechas raras (el fallo "Hace NaN meses") ----------
check('normalizeDate: texto normal', normalizeDate('2026-10-29') === '2026-10-29');
check('normalizeDate: con hora', normalizeDate('2026-10-29T00:00:00.000Z') === '2026-10-29');
check('normalizeDate: fecha larga que mandó el servidor por error', normalizeDate('Thu Oct 29 2026 00:00:00 GMT+0100 (hora estándar de Europa central)') === '2026-10-29', normalizeDate('Thu Oct 29 2026 00:00:00 GMT+0100 (hora estándar de Europa central)'));
check('normalizeDate: basura -> vacío', normalizeDate('esto no es una fecha') === '' && normalizeDate('') === '' && normalizeDate(null) === '');
const rota = E('bano', 'Laura', 'fecha rota');
check('un apunte con fecha rota no cuenta como "última vez" ni da NaN', taskState(TAREAS.bano, [rota], hoy).level === 'none' && taskState(TAREAS.bano, [rota], hoy).ago === 'Sin registros');
check('con uno roto y otro bueno, se usa el bueno', taskState(TAREAS.bano, [rota, E('bano', 'Elena', '2026-10-27')], hoy).last.who === 'Elena');
check('la sugerencia no se descontrola con fechas rotas (usa solo los apuntes buenos)', suggestWho([rota, rota, E('bano', 'Laura', '2026-10-20')], STAFF, reparto, 'bano', hoy) === 'Elena');

// ---------- Reparto de los últimos 90 días ----------
const rp = shareStats(PAPEL, STAFF, reparto, hoy);
check('reparto con el papel (desde el 31/07): Elena 1 de 8 y Laura 7 de 8', rp.total === 8 && rp.rows[0].count === 1 && rp.rows[1].count === 7, rp);
check('reparto: porcentajes 13 % y 88 % y le corresponde 50 % a cada una', rp.rows[0].pct === 13 && rp.rows[1].pct === 88 && rp.rows[0].target === 50 && rp.rows[1].target === 50, rp.rows);
check('reparto por horas (65/35): le corresponde 65 % y 35 %', shareStats(PAPEL, STAFF, { Elena: 65, Laura: 35 }, hoy).rows.map(r => r.target).join() === '65,35');
check('reparto sin apuntes: total 0', shareStats([], STAFF, reparto, hoy).total === 0 && shareStats([rota], STAFF, reparto, hoy).total === 0);

// Reparto real del papel (para el informe)
const cuenta = p => PAPEL.filter(e => e.who === p).length;
console.log('   (papel: Elena', cuenta('Elena'), '· Laura', cuenta('Laura'), ')');

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nLógica de limpieza OK');
process.exit(failed ? 1 : 0);
