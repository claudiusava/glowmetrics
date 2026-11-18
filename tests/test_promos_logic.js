// Lógica de las ofertas con unidades limitadas (promos-logic.ts).
// Ejecutar desde la carpeta frontend:  NODE_PATH=$(pwd)/node_modules node ../tests/test_promos_logic.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '../frontend/src/app/components/promos-board/promos-logic.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText)(m, m.exports, () => ({}));
const { remaining, lowThreshold, promoLevel, buildSections, promoTotals, campaignText, offerName, newRequestId, promoErrorText, SECTION_TITLES } = m.exports;

// Las ofertas reales del servidor (cfg_config.js), para que la web y el servidor no se desincronicen
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../cfg_config.js'), 'utf8') + '\n;this.OFFERS = PROMO_OFFERS; this.CAMPAIGN = PROMO_CAMPAIGN;', ctx);
const OFFERS = JSON.parse(JSON.stringify(ctx.OFFERS));
const CAMPAIGN = JSON.parse(JSON.stringify(ctx.CAMPAIGN));

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

// Cuántas quedan
check('quedan = límite - vendidas', remaining(15, 4) === 11 && remaining(50, 0) === 50);
check('nunca negativas, aunque se vendan de más o baje el límite', remaining(15, 20) === 0 && remaining(15, -3) === 15);

// Avisos de color
check('umbral de "pocas": 3 de 15, 5 de 25, 10 de 50', lowThreshold(15) === 3 && lowThreshold(25) === 5 && lowThreshold(50) === 10);
check('de sobra (ok)', promoLevel(25, 0) === 'ok' && promoLevel(25, 19) === 'ok');
check('quedan pocas (low): 5 de 25', promoLevel(25, 20) === 'low' && promoLevel(15, 12) === 'low' && promoLevel(50, 49) === 'low');
check('agotada (out): 0 quedan', promoLevel(25, 25) === 'out' && promoLevel(15, 99) === 'out');
check('una oferta de pocas unidades (límite 3) es "low" desde el principio, no "out"', promoLevel(3, 0) === 'low');

// Agrupación como en el cartel
const sin = () => 0;
const secs = buildSections(OFFERS, sin);
check('4 secciones en orden (mujeres a la izquierda, hombres a la derecha, en las dos filas): mujer, hombre, y las de 3 €, 2 € y 1 € de mujer y de hombre', secs.map(s => s.section).join() === 'mujer,hombre,minis-mujer,minis-hombre' && secs.map(s => s.title).join('|') === 'Mujer|Hombre|Mujer · ofertas de 3 €, 2 € y 1 €|Hombre · ofertas de 3 €, 2 € y 1 €', secs.map(s => s.title));
check('mujer: 3 tratamientos de 3 variantes (3, 2 y 1 sesiones)', secs[0].groups.length === 3 && secs[0].groups.every(g => g.cards.length === 3) && secs[0].groups[0].cards.map(c => c.offer.label).join() === '3 sesiones,2 sesiones,1 sesión');
check('hombre: cuerpo completo, piernas completas y espalda + tórax + hombros', secs[1].groups.map(g => g.name).join('|') === 'Cuerpo completo|Piernas completas|Espalda completa + tórax + hombros');
check('las de 3 €, 2 € y 1 € de mujer: ingles normales y axilas, cada una con 3 precios', secs[2].groups.map(g => g.name).join('|') === 'Ingles normales|Axilas' && secs[2].groups.every(g => g.cards.map(c => c.offer.label).join() === 'a 3 €,a 2 €,a 1 €'));
check('las de 3 €, 2 € y 1 € de hombre: solo axilas, con 3 precios', secs[3].groups.map(g => g.name).join('|') === 'Axilas' && secs[3].groups[0].cards.map(c => c.offer.label).join() === 'a 3 €,a 2 €,a 1 €');
check('límite total: mujer 385, hombre 390, 3 €/2 €/1 € de mujer 150 y de hombre 75', secs.map(s => s.limit).join() === '385,390,150,75', secs.map(s => s.limit));

// Con ventas
const vendidas = { 'mujer-cuerpo-3': 12, 'mini-mujer-axilas-3': 25, 'hombre-cuerpo-2': 5, 'mujer-piernas-1': 99 };
const conVentas = buildSections(OFFERS, id => vendidas[id] ?? 0);
const card = id => conVentas.flatMap(s => s.groups.flatMap(g => g.cards)).find(c => c.offer.id === id);
check('tarjeta con ventas: 12 vendidas, quedan 3, pocas', card('mujer-cuerpo-3').sold === 12 && card('mujer-cuerpo-3').left === 3 && card('mujer-cuerpo-3').level === 'low');
check('barra de progreso en %: 12 de 15 = 80', card('mujer-cuerpo-3').pct === 80 && card('hombre-cuerpo-2').pct === 20);
check('agotada: 25 de 25 = 100 % y level out', card('mini-mujer-axilas-3').level === 'out' && card('mini-mujer-axilas-3').pct === 100 && card('mini-mujer-axilas-3').left === 0);
check('vendidas de más (99 de 50): la barra no pasa de 100 y no suma de más al total', card('mujer-piernas-1').pct === 100 && card('mujer-piernas-1').left === 0);
const tot = promoTotals(conVentas);
check('total vendidas = 12 + 25 + 5 + 50 (lo de más no cuenta) = 92 de 1000', tot.sold === 92 && tot.limit === 1000, tot);
check('contadores de agotadas (2: axilas 3 € y piernas 1 sesión) y casi agotadas (1)', tot.soldOut === 2 && tot.low === 1, tot);
check('ventas negativas (dato roto) cuentan como 0', buildSections(OFFERS, () => -5).every(s => s.groups.every(g => g.cards.every(c => c.sold === 0))));

// Textos
check('campaña: "Del 18 al 30 de noviembre"', campaignText(CAMPAIGN.from, CAMPAIGN.to) === 'Del 18 al 30 de noviembre', campaignText(CAMPAIGN.from, CAMPAIGN.to));
check('campaña que cruza de mes', campaignText('2026-11-28', '2026-12-03') === 'Del 28 de noviembre al 3 de diciembre');
check('fechas rotas: texto vacío', campaignText('', '') === '' && campaignText('18/11', '30/11') === '');
check('nombre de oferta con sección y variante', offerName(OFFERS.find(o => o.id === 'mujer-cuerpo-3')) === 'Mujer · Cuerpo completo · 3 sesiones', offerName(OFFERS[0]));
check('nombre de las de 3 €: "Mujer · Axilas a 3 €"', offerName(OFFERS.find(o => o.id === 'mini-mujer-axilas-3')) === 'Mujer · Axilas a 3 €');
check('mensajes de error en español para cada código', ['sold-out', 'nothing-to-undo', 'invalid-number', 'otro'].every(c => /[a-záéíóú]/i.test(promoErrorText(c, OFFERS[0]))) && /agotar/.test(promoErrorText('sold-out', OFFERS[0])));
check('identificadores de escritura distintos cada vez', new Set(Array.from({ length: 50 }, newRequestId)).size === 50);
check('todas las secciones de la configuración tienen título', OFFERS.every(o => SECTION_TITLES[o.section]));

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nLógica de ofertas OK');
process.exit(failed ? 1 : 0);
