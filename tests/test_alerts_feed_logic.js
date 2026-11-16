// Cuándo se piden los avisos de las pestañas (alerts-feed-logic.ts).
// Ejecutar desde la carpeta frontend:  NODE_PATH=$(pwd)/node_modules node ../tests/test_alerts_feed_logic.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../frontend/src/app/services/alerts-feed-logic.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText)(m, m.exports);
const { dueForRefresh, FEED_EVERY_MS, FEED_MIN_GAP_MS, FEED_FIRST_DELAY_MS } = m.exports;

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const t0 = 1_000_000;
check('al volver a la pestaña tras más del margen: se pide de nuevo', dueForRefresh(t0 + FEED_MIN_GAP_MS, t0, false));
check('al volver enseguida: no se pide otra vez (lo último es reciente)', !dueForRefresh(t0 + 5_000, t0, false));
check('con la pestaña escondida no se pide', !dueForRefresh(t0 + 10 * FEED_MIN_GAP_MS, t0, true));
check('si nunca se pidió (lastAt = 0) y la pestaña se ve: se pide', dueForRefresh(t0, 0, false));
check('el turno normal es de varios minutos, no de uno (antes eran 3 peticiones por minuto)', FEED_EVERY_MS >= 5 * 60_000);
check('primero va la petición principal: los avisos esperan unos segundos', FEED_FIRST_DELAY_MS >= 3_000);

console.log(failed ? `\n${failed} FALLOS` : '\nAvisos agrupados OK');
process.exit(failed ? 1 : 0);
