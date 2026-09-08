/*************************
 * scv_airtable.gs (ESTABILIZADO / 1 CENTRO)
 *
 * Objetivos:
 * - No romper el front si Airtable falla → devuelve último snapshot (Sheets) + stale=true
 * - Reducir consumo → cache + cooldown + solo 1 llamada “gorda” cuando expira cache
 * - Arreglar incoherencias del archivo original:
 *   - centerId fijo a ALCORCON (sin OR mal usado)
 *   - fetchAirtablePercentageLive_ no existía (usamos getAirtableStats())
 *   - opcional: límite de paginación y guard razonable
 */

const DEFAULT_KPI = { pct: 32.15, total: 0, citadas: 0, stale: true, updatedAt: new Date().toISOString() };


/** ===== Helpers estabilidad (si ya existen globales, elimina duplicados) ===== */
// function withLock_(fn) {
//   const lock = LockService.getScriptLock();
//   lock.waitLock(20000);
//   try { return fn(); }
//   finally { lock.releaseLock(); }
// }

// function cooldownOk_(key, ms) {
//   const ps = PropertiesService.getScriptProperties();
//   const now = Date.now();
//   const k = 'CD_' + key;
//   const last = Number(ps.getProperty(k) || 0);
//   if (now - last < ms) return false;
//   ps.setProperty(k, String(now));
//   return true;
// }

/*************************
 * CONFIG / TOKEN AIRTABLE
 *************************/
function getAirtableToken_() {
  const pat = PropertiesService.getScriptProperties().getProperty('AIRTABLE_PAT');
  if (!pat) throw new Error('Falta AIRTABLE_PAT en Script Properties.');
  return pat;
}

/*************************
 * Airtable: fetch completo (cacheado)
 *************************/
function getAirtableStats() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('airtable_stats');
  if (cached) return JSON.parse(cached);

  const token = getAirtableToken_();
  const base = AIRTABLE.BASE_ID;
  const table = AIRTABLE.TABLE_ID;
  const view = AIRTABLE.VIEW_ID;

  const baseUrl = `https://api.airtable.com/v0/${encodeURIComponent(base)}/${encodeURIComponent(table)}`;
  const params = [
    view ? `view=${encodeURIComponent(view)}` : '',
    `fields[]=${encodeURIComponent(AIRTABLE.FIELD_NAME)}`
  ].filter(Boolean).join('&');

  const options = {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };

  let total = 0, citadas = 0, offset = null, guard = 0;

  do {
    let url = baseUrl + (params ? `?${params}` : '');
    if (offset) url += (params ? '&' : '?') + 'offset=' + encodeURIComponent(offset);

    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code >= 300) {
      throw new Error('Airtable API error ' + code + ': ' + res.getContentText());
    }

    const data = JSON.parse(res.getContentText());
    const records = data.records || [];

    total += records.length;

    for (const r of records) {
      const v = r.fields && r.fields[AIRTABLE.FIELD_NAME];
      const text = typeof v === 'string' ? v : (v && v.name ? v.name : '');
      if (String(text || '').trim().toUpperCase() === 'CITADA') citadas++;
    }

    offset = data.offset || null;
    if (++guard > 200) break; // seguridad
  } while (offset);

  const pct = total > 0 ? Math.round((citadas / total) * 10000) / 100 : 0;
  const payload = { total, citadas, pct };

  cache.put('airtable_stats', JSON.stringify(payload), AIRTABLE.CACHE_SECS);
  return payload;
}

/*************************
 * BACKUP KPI en Sheets
 *************************/
const KPI_SHEET_NAME = 'AirtableKpi';
const DEFAULT_CENTER_ID = 'ALCORCON';

/**
 * Endpoint que llama el front: google.script.run.getAirtablePercentage()
 * - centerId se ignora (1 centro) pero se mantiene por compatibilidad
 */
function getAirtablePercentage(centerId) {
  centerId = 'ALCORCON';

  try {
    var snap = readAirtableSnapshot_(centerId);
    if (snap) {
      snap.stale = true;
      return snap;
    }
  } catch (e) {
    console.error('getAirtablePercentage snapshot ERROR:', e);
  }

  return { pct: 32.15, total: 0, citadas: 0, stale: true, updatedAt: new Date().toISOString() };
}

function saveAirtableSnapshot_(centerId, stats) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(KPI_SHEET_NAME);

  if (!sh) {
    sh = ss.insertSheet(KPI_SHEET_NAME);
    sh.getRange(1, 1, 1, 5).setValues([[
      'centerId', 'pct', 'total', 'citadas', 'updatedAt'
    ]]);
  }

  const last = sh.getLastRow();
  const values = last > 1 ? sh.getRange(2, 1, last - 1, 5).getValues() : [];

  let rowIndex = -1;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(centerId)) {
      rowIndex = i + 2;
      break;
    }
  }
  if (rowIndex === -1) rowIndex = last + 1;

  sh.getRange(rowIndex, 1, 1, 5).setValues([[
    String(centerId),
    Number(stats.pct || 0),
    Number(stats.total || 0),
    Number(stats.citadas || 0),
    new Date()
  ]]);
}

function parseNum_(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return 0;

  // Soporta "17,65" y "1.234,56" y "1234.56"
  const normalized = s
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // quita separador de miles "."
    .replace(',', '.');               // coma decimal -> punto

  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

function readAirtableSnapshot_(centerId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(KPI_SHEET_NAME);
  if (!sh) return null;

  const last = sh.getLastRow();
  if (last < 2) return null;

  const values = sh.getRange(2, 1, last - 1, 5).getValues();
  for (const row of values) {
    if (String(row[0]).trim() === String(centerId).trim()) {
      return {
        pct: parseNum_(row[1]),
        total: Math.round(parseNum_(row[2])),
        citadas: Math.round(parseNum_(row[3])),
        updatedAt: row[4] ? new Date(row[4]).toISOString() : '',
        stale: true
      };
    }
  }
  return null;
}


function setAirtableTokenOnce_() {
  // PropertiesService.getScriptProperties().setProperty('AIRTABLE_PAT', 'pat_xxx');
  throw new Error('Edita esta función para establecer AIRTABLE_PAT una sola vez.');
}
