// Lógica del registro de limpieza (cleaning-logic.ts) con los datos reales del papel.
// Ejecutar desde la carpeta frontend:  NODE_PATH=$(pwd)/node_modules node ../tests/test_cleaning_logic.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '../frontend/src/app/components/cleaning-board/cleaning-logic.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText)(m, m.exports);
const { todayIso, daysBetween, lastEntry, agoText, soonDays, statusText, taskState, dirtColor, todoNow, suggestWho, normalizeDate, shareStats } = m.exports;

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const E = (task, who, date, note = '', n = 0) => ({ id: task + who + date + n, task, who, date, note, createdAt: date + 'T10:00:00Z' + n });
const TAREAS = {
  recepcion: { id: 'recepcion', name: 'Polvo recepción', icon: '', everyDays: 5 },
  cabina1: { id: 'cabina1', name: 'Polvo cabina 1', icon: '', everyDays: 3 },
  cabina2: { id: 'cabina2', name: 'Polvo cabina 2', icon: '', everyDays: 3 },
  bano: { id: 'bano', name: 'Baño', icon: '', everyDays: 10 },
  cristales: { id: 'cristales', name: 'Cristales', icon: '', everyDays: 60 },
};
const LISTA = Object.values(TAREAS);
const STAFF = ['Elena', 'Laura'];
const hoy = '2026-10-29';
const haceDias = n => new Date(Date.UTC(2026, 9, 29 - n)).toISOString().slice(0, 10);

check('daysBetween: 29/10 - 21/09 = 38 días', daysBetween('2026-09-21', '2026-10-29') === 38);
check('daysBetween cruza el cambio de hora y de año', daysBetween('2025-12-31', '2026-01-02') === 2 && daysBetween('2026-10-24', '2026-10-26') === 2);
check('todayIso en formato AAAA-MM-DD', todayIso(new Date(2026, 0, 5)) === '2026-01-05');
check('textos: hoy, ayer, días, semanas, meses', [0, 1, 5, 21, 70].map(agoText).join('|') === 'Hoy|Ayer|Hace 5 días|Hace 3 semanas|Hace 2 meses', [0, 1, 5, 21, 70].map(agoText));

// ---------- Cuánto falta y qué aviso toca (baño: plazo 15 días, "se acerca" a los 4 días) ----------
check('"se acerca": un cuarto del plazo, mínimo 1 día', soonDays(TAREAS.bano) === 3 && soonDays(TAREAS.recepcion) === 1 && soonDays(TAREAS.cabina1) === 1 && soonDays(TAREAS.cristales) === 15 && soonDays({ everyDays: 1 }) === 1);
check('textos de estado', [6, 2, 1, 0, -1, -3].map(statusText).join('|') === 'Faltan 6 días|Faltan 2 días|Toca mañana|Toca hoy|Atrasada 1 día|Atrasada 3 días', [6, 2, 1, 0, -1, -3].map(statusText));

const bano = n => taskState(TAREAS.bano, [E('bano', 'Laura', haceDias(n))], hoy);
check('sin registros: nivel "none", sin barra', taskState(TAREAS.bano, [], hoy).level === 'none' && taskState(TAREAS.bano, [], hoy).ratio === 0 && taskState(TAREAS.bano, [], hoy).status === 'Sin registros');
check('baño limpio hoy: ok, barra vacía y faltan 10 días', bano(0).level === 'ok' && bano(0).ratio === 0 && bano(0).daysLeft === 10 && bano(0).status === 'Faltan 10 días');
check('baño hace 3 días: ok, faltan 7, barra a un tercio', bano(3).level === 'ok' && bano(3).daysLeft === 7 && Math.abs(bano(3).ratio - 0.3) < 1e-9);
check('baño: faltan 4 días (hecho hace 6): todavía ok', bano(6).level === 'ok' && bano(6).daysLeft === 4);
check('baño: faltan 3 días (hecho hace 7): se acerca', bano(7).level === 'soon' && bano(7).daysLeft === 3);
check('baño: faltan 2 días (hecho hace 8): se acerca, la barra casi llena', bano(8).level === 'soon' && bano(8).ratio > 0.79);
check('baño: toca mañana (hecho hace 9)', bano(9).level === 'soon' && bano(9).status === 'Toca mañana');
check('baño: toca hoy (hecho hace 10): barra llena', bano(10).level === 'due' && bano(10).ratio === 1 && bano(10).status === 'Toca hoy');
check('baño: atrasado 3 días (hecho hace 13): barra llena y en rojo', bano(13).level === 'late' && bano(13).daysLeft === -3 && bano(13).ratio === 1 && bano(13).status === 'Atrasada 3 días');
check('cabina (cada 3 días): hecha ayer -> toca mañana... faltan 2; hecha hace 3 -> toca hoy',
  taskState(TAREAS.cabina1, [E('cabina1', 'Elena', haceDias(1))], hoy).status === 'Faltan 2 días' && taskState(TAREAS.cabina1, [E('cabina1', 'Elena', haceDias(3))], hoy).level === 'due');
check('se usa el apunte MÁS RECIENTE aunque se apuntara antes', taskState(TAREAS.bano, [E('bano', 'Laura', haceDias(2)), E('bano', 'Elena', haceDias(40))], hoy).last.who === 'Laura');
check('a igual fecha manda el último que se apuntó', lastEntry([E('bano', 'Laura', '2026-10-27', '', 1), E('bano', 'Elena', '2026-10-27', '', 2)], 'bano').who === 'Elena');
check('una fecha futura (reloj desfasado) no da días negativos', taskState(TAREAS.bano, [E('bano', 'Laura', '2026-11-02')], hoy).days === 0);
check('cristales (60 días): hecho hace 19, faltan 41', taskState(TAREAS.cristales, [E('cristales', 'Elena', haceDias(19))], hoy).status === 'Faltan 41 días');

// Color de la barra: del agua al naranja y rojo si está atrasada
const hue = s => Number(dirtColor(s).match(/hsl\((\d+)/)[1]);
check('color: sin registros gris, atrasada roja', dirtColor(taskState(TAREAS.bano, [], hoy)) === '#cbd5e1' && dirtColor(bano(13)) === '#e11d48');
check('color: limpio verde-agua y casi tocando naranja', hue(bano(0)) === 165 && hue(bano(9)) < 40, [dirtColor(bano(0)), dirtColor(bano(9))]);
check('color: el tono baja a medida que se ensucia', hue(bano(0)) > hue(bano(3)) && hue(bano(3)) > hue(bano(7)) && hue(bano(7)) > hue(bano(9)), [0, 3, 7, 9].map(n => hue(bano(n))));

// ---------- Qué hay que hacer ahora ----------
const mezcla = [
  E('recepcion', 'Laura', haceDias(2)),   // faltan 3
  E('cabina1', 'Laura', haceDias(3)),     // toca hoy
  E('cabina2', 'Elena', haceDias(8)),     // atrasada 5
  E('bano', 'Elena', haceDias(8)),        // se acerca
];
const urgente = todoNow(LISTA, mezcla, hoy);
check('"toca ahora": las de hoy y las atrasadas, la más atrasada primero', urgente.map(x => x.task.id).join() === 'cabina2,cabina1', urgente.map(x => x.task.id));
check('"toca ahora": las que solo se acercan o no tienen registros no cuentan', !urgente.some(x => ['bano', 'cristales', 'recepcion'].includes(x.task.id)));
check('todo al día: nada que hacer ya', todoNow(LISTA, [E('bano', 'Laura', haceDias(1))], hoy).length === 0);

// ---------- Papel real (lo leído de la foto, año 2026) ----------
const PAPEL = [
  E('recepcion', 'Elena', '2026-01-21'), E('recepcion', 'Laura', '2026-01-30'), E('recepcion', 'Elena', '2026-02-11'),
  E('recepcion', 'Laura', '2026-02-17'), E('recepcion', 'Elena', '2026-05-05', 'solo suelo'), E('recepcion', 'Elena', '2026-06-15', 'solo suelo'),
  E('recepcion', 'Elena', '2026-08-04'), E('recepcion', 'Laura', '2026-09-21'),
  E('bano', 'Elena', '2026-01-23'), E('bano', 'Laura', '2026-01-26'), E('bano', 'Elena', '2026-02-12'), E('bano', 'Laura', '2026-02-19'),
  E('bano', 'Laura', '2026-03-23'), E('bano', 'Elena', '2026-05-05'), E('bano', 'Elena', '2026-06-15', 'solo suelo'), E('bano', 'Laura', '2026-06-17'),
  E('bano', 'Laura', '2026-07-17'), E('bano', 'Laura', '2026-08-17'), E('bano', 'Laura', '2026-09-03'), E('bano', 'Laura', '2026-09-21'),
  E('cabina1', 'Elena', '2026-01-20'), E('cabina1', 'Laura', '2026-01-26'), E('cabina1', 'Laura', '2026-02-09'), E('cabina1', 'Laura', '2026-02-17'),
  E('cabina1', 'Laura', '2026-03-23'), E('cabina1', 'Elena', '2026-04-20', 'solo suelo'), E('cabina1', 'Laura', '2026-04-29'), E('cabina1', 'Laura', '2026-05-05'),
  E('cabina1', 'Elena', '2026-05-05'), E('cabina1', 'Elena', '2026-06-22'), E('cabina1', 'Laura', '2026-08-17'), E('cabina1', 'Laura', '2026-09-03'), E('cabina1', 'Laura', '2026-09-21'),
];
const estado = id => taskState(TAREAS[id], PAPEL, hoy);
check('papel: baño, última vez el 21/09 (38 días): atrasado 28 días', estado('bano').days === 38 && estado('bano').level === 'late' && estado('bano').status === 'Atrasada 28 días' && estado('bano').last.who === 'Laura');
check('papel: recepción, última vez el 21/09 (38 días, plazo 5): atrasada 33 días', estado('recepcion').level === 'late' && estado('recepcion').status === 'Atrasada 33 días');
check('papel: cabina 1 (plazo 3): atrasada 35 días', estado('cabina1').status === 'Atrasada 35 días');
check('papel: cristales sin registros', estado('cristales').level === 'none');

// ---------- A quién le toca (por horas: Elena 40 h, Laura 25 h) ----------
const reparto = { Elena: 50, Laura: 50 };
const porHoras = { Elena: 40, Laura: 25 };
check('papel, partes iguales: le toca a Elena (casi todo lo reciente lo ha hecho Laura)', suggestWho(PAPEL, STAFF, reparto, 'bano', hoy) === 'Elena');
check('papel, por horas (40/25): también le toca a Elena', suggestWho(PAPEL, STAFF, porHoras, 'bano', hoy) === 'Elena');
check('si Laura tuviera el 95 % del reparto, le tocaría a Laura (aunque haga mucho)', suggestWho(PAPEL, STAFF, { Elena: 5, Laura: 95 }, 'bano', hoy) === 'Laura');
check('por horas, con 3 apuntes de cada una sigue tocándole a Elena (le corresponde más)', suggestWho([10, 20, 30].map(i => E('bano', 'Elena', haceDias(i))).concat([11, 21, 31].map(i => E('bano', 'Laura', haceDias(i)))), STAFF, porHoras, 'bano', hoy) === 'Elena');
check('por horas, con 6 de Elena y 2 de Laura (75 % > 61,5 %) le toca a Laura', suggestWho([1, 2, 3, 4, 5, 6].map(i => E('bano', 'Elena', haceDias(i))).concat([E('bano', 'Laura', haceDias(7)), E('bano', 'Laura', haceDias(8))]), STAFF, porHoras, 'bano', hoy) === 'Laura');
check('sin apuntes y a partes iguales: empate sin sugerencia', suggestWho([], STAFF, reparto, 'bano', hoy) === null);
check('empate en el reparto: le toca a quien lleve más tiempo sin esa tarea',
  suggestWho([E('bano', 'Elena', '2026-10-01'), E('bano', 'Laura', '2026-10-10')], STAFF, reparto, 'bano', hoy) === 'Elena');
check('solo cuentan los últimos 90 días (lo anterior no pesa)',
  suggestWho([E('bano', 'Laura', '2026-01-01'), E('bano', 'Laura', '2026-01-02'), E('bano', 'Elena', '2026-10-20')], STAFF, reparto, 'bano', hoy) === 'Laura');
check('personas fuera de la lista no cuentan', suggestWho([E('bano', 'Paco', '2026-10-20')], STAFF, reparto, 'bano', hoy) === null);

// ---------- Fechas raras (el fallo "Hace NaN meses") ----------
check('normalizeDate: texto normal y con hora', normalizeDate('2026-10-29') === '2026-10-29' && normalizeDate('2026-10-29T00:00:00.000Z') === '2026-10-29');
check('normalizeDate: fecha larga que mandó el servidor por error', normalizeDate('Thu Oct 29 2026 00:00:00 GMT+0100 (hora estándar de Europa central)') === '2026-10-29');
check('normalizeDate: basura -> vacío', normalizeDate('esto no es una fecha') === '' && normalizeDate('') === '' && normalizeDate(null) === '');
const rota = E('bano', 'Laura', 'fecha rota');
check('un apunte con fecha rota no cuenta como "última vez" ni da NaN', taskState(TAREAS.bano, [rota], hoy).level === 'none' && taskState(TAREAS.bano, [rota], hoy).ago === 'Sin registros');
check('con uno roto y otro bueno, se usa el bueno', taskState(TAREAS.bano, [rota, E('bano', 'Elena', '2026-10-27')], hoy).last.who === 'Elena');
check('la sugerencia no se descontrola con fechas rotas', suggestWho([rota, rota, E('bano', 'Laura', '2026-10-20')], STAFF, reparto, 'bano', hoy) === 'Elena');

// ---------- Reparto de los últimos 90 días ----------
const rp = shareStats(PAPEL, STAFF, reparto, hoy);
check('reparto con el papel (desde el 31/07): Elena 1 de 8 y Laura 7 de 8', rp.total === 8 && rp.rows[0].count === 1 && rp.rows[1].count === 7, rp);
check('reparto: porcentajes 13 % y 88 %', rp.rows[0].pct === 13 && rp.rows[1].pct === 88, rp.rows);
check('reparto por horas (40/25): le corresponde 62 % a Elena y 38 % a Laura', shareStats(PAPEL, STAFF, porHoras, hoy).rows.map(r => r.target).join() === '62,38', shareStats(PAPEL, STAFF, porHoras, hoy).rows);
check('reparto sin apuntes: total 0', shareStats([], STAFF, reparto, hoy).total === 0 && shareStats([rota], STAFF, reparto, hoy).total === 0);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nLógica de limpieza OK');
process.exit(failed ? 1 : 0);
