// Mensaje bajo la escala del indicador (kpi-message.ts), según el tramo de color.
// Ejecutar desde la carpeta frontend:  NODE_PATH=$(pwd)/node_modules node ../tests/test_kpi_message.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../frontend/src/app/components/kpi-card/kpi-message.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText)(m, m.exports);
const { kpiMessage } = m.exports;

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };
const t = pct => (kpiMessage(pct, 700) || {}).text;

check('40 % o más: objetivo superado', /superado/.test(t(40)) && /superado/.test(t(47.3)), [t(40), t(47.3)]);
check('38 a 40: casi', /Casi/.test(t(38)) && /Casi/.test(t(39.99)));
check('36 a 38: vamos bien pero hay que llegar al 40 %', /Vamos bien/.test(t(36)) && /Vamos bien/.test(t(36.65)) && /Vamos bien/.test(t(37.99)));
check('34 a 36: cada lead cuenta', /cada lead/.test(t(34)) && /cada lead/.test(t(35.5)));
check('32 a 34: flojo', /flojo/.test(t(32)) && /flojo/.test(t(33.9)));
check('30 a 32: alerta', /Alerta/.test(t(30)) && /Alerta/.test(t(31.9)));
check('menos de 30: muy bajo', /Muy bajo/.test(t(29.99)) && /Muy bajo/.test(t(12)));
check('los límites cambian de tramo justo en el número redondo', t(36) !== t(35.99) && t(38) !== t(37.99) && t(40) !== t(39.99) && t(30) !== t(29.99));
check('cada tramo tiene su propio color de texto', new Set([47, 39, 37, 35, 33, 31, 20].map(p => kpiMessage(p, 700).color)).size === 7);
check('sin leads no se dice nada (0 % no significa nada)', kpiMessage(0, 0) === null && kpiMessage(36, 0) === null);
check('valores raros no rompen nada', kpiMessage(NaN, 700) === null && kpiMessage(Infinity, 700) === null);
const largo = [47, 39, 37, 35, 33, 31, 20].map(p => kpiMessage(p, 700).text.length);
check('los mensajes caben en una línea (máx. 45 letras)', Math.max(...largo) <= 45, largo);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nMensaje del indicador OK');
process.exit(failed ? 1 : 0);
