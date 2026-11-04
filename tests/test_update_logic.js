// Recarga automática por versión nueva (update-logic.ts).
// Ejecutar desde la carpeta frontend:  NODE_PATH=$(pwd)/node_modules node ../tests/test_update_logic.js
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../frontend/src/app/services/update-logic.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2019' } }).outputText)(m, m.exports);
const { hasNewVersion, versionKey, canReload, versionFiles, IDLE_BEFORE_RELOAD_MS } = m.exports;

let failed = 0;
const check = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n + (c ? '' : '  ' + JSON.stringify(x))); if (!c) failed++; };

const v1 = ['main-AAA.js', 'polyfills-111.js', 'styles-xyz.css'];
const v2 = ['main-BBB.js', 'polyfills-111.js', 'styles-xyz.css'];
check('mismos ficheros: no hay versión nueva', !hasNewVersion(v1, [...v1]));
check('el orden no importa', !hasNewVersion(v1, [...v1].reverse()));
check('un fichero con otro hash: versión nueva', hasNewVersion(v1, v2));
check('un fichero de más o de menos: versión nueva', hasNewVersion(v1, [...v1, 'chunk-1.js']) && hasNewVersion(v1, v1.slice(1)));
check('si no se pudo leer la página nueva, no se recarga', !hasNewVersion(v1, []));
check('versionKey no depende del orden', versionKey(v2) === versionKey([...v2].reverse()) && versionKey(v1) !== versionKey(v2));

const vivo = ['polyfills-111.js', 'main-AAA.js', 'https://script.google.com/macros/s/X/exec?route=notes-list&callback=gm_jsonp_1', 'cdn/otro.js?v=2', '//otro.com/x.js'];
check('solo cuentan los ficheros propios (no las peticiones JSONP ni los de otros sitios)', versionFiles(vivo).join() === 'polyfills-111.js,main-AAA.js', versionFiles(vivo));
check('una petición en curso no cuenta como versión nueva', !hasNewVersion(versionFiles(vivo), versionFiles(['polyfills-111.js', 'main-AAA.js'])));

const now = 1_000_000_000;
const base = { now, lastActivityAt: now - IDLE_BEFORE_RELOAD_MS, typing: false, alreadyReloadedFor: null, latestKey: 'k2' };
check('en reposo y sin nada a medias: se recarga', canReload(base));
check('si alguien la ha tocado hace poco: no', !canReload({ ...base, lastActivityAt: now - 60_000 }));
check('si el foco está en un campo de texto: no', !canReload({ ...base, typing: true }));
check('si ya se recargó a esta versión y sigue igual: no (evita el bucle)', !canReload({ ...base, alreadyReloadedFor: 'k2' }));
check('si se recargó a otra versión anterior: sí', canReload({ ...base, alreadyReloadedFor: 'k1' }));
check('el reposo exigido es de varios minutos', IDLE_BEFORE_RELOAD_MS >= 3 * 60_000);

console.log(failed ? '\n' + failed + ' comprobaciones FALLAN' : '\nRecarga por versión nueva OK');
process.exit(failed ? 1 : 0);
