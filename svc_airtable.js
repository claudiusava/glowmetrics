/*************************
 *  CONFIG / TOKEN AIRTABLE
 *************************/
function getAirtableToken_() {
  const pat = PropertiesService.getScriptProperties().getProperty('AIRTABLE_PAT');
  if (!pat) throw new Error('Falta AIRTABLE_PAT en Script Properties.');
  return pat;
}

/*************************
 *  % CITADAS (Airtable)
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
    if (res.getResponseCode() >= 300) {
      throw new Error('Airtable API error ' + res.getResponseCode() + ': ' + res.getContentText());
    }
    const data = JSON.parse(res.getContentText());

    const records = data.records || [];
    total += records.length;

    for (const r of records) {
      const v = r.fields && r.fields[AIRTABLE.FIELD_NAME];
      const text = typeof v === 'string' ? v : (v && v.name ? v.name : '');
      if ((text || '').toString().trim().toUpperCase() === 'CITADA') citadas++;
    }

    offset = data.offset || null;
    if (++guard > 100) break;
  } while (offset);

  const pct = total > 0 ? Math.round((citadas / total) * 10000) / 100 : 0;

  const payload = { total, citadas, pct };
  cache.put('airtable_stats', JSON.stringify(payload), AIRTABLE.CACHE_SECS);
  return payload;
}

function getAirtablePercentage() {
  return getAirtableStats();
}

function setAirtableTokenOnce_() {
  // PropertiesService.getScriptProperties().setProperty('AIRTABLE_PAT', 'pat_xxx');
  throw new Error('Edita esta función para establecer AIRTABLE_PAT una sola vez.');
}
