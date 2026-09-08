/** =========================
 * svc_sheets.gs (ESTABILIZADO)
 * =========================
 * Cambios:
 * - Lock para evitar carreras (lecturas/escrituras simultáneas)
 * - ensureSheets_ deja el Meta con headers y valores en fila 2 si faltan
 * - readWindow_ tolera filas vacías y normaliza tipos
 * - writeWindow_ hace escritura atómica (clear + setValues) dentro del lock
 * - getMeta_/setMeta_ toleran hoja inexistente (por si llaman antes de ensure)
 */

/** withLock_ definido una sola vez en api_public.js para evitar duplicados. */

function ensureSheets_() {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    let meta = ss.getSheetByName('Meta');
    if (!meta) {
      meta = ss.insertSheet('Meta');
    }

    // Headers
    if (!meta.getRange('A1').getValue()) meta.getRange('A1').setValue('placeUrl');
    if (!meta.getRange('B1').getValue()) meta.getRange('B1').setValue('totalCount');

    // Asegurar celdas de datos (fila 2) existentes
    if (meta.getRange('A2').getValue() === '' && typeof PLACE_URL !== 'undefined' && PLACE_URL) {
      meta.getRange('A2').setValue(PLACE_URL);
    }
    if (meta.getRange('B2').getValue() === '') {
      meta.getRange('B2').setValue(0);
    }

    let reviews = ss.getSheetByName('GlowMetrics');
    if (!reviews) {
      reviews = ss.insertSheet('GlowMetrics');
      reviews.getRange(1, 1, 1, 7).setValues([[
        'reviewId', 'number', 'rating', 'author', 'text', 'publishedAt', 'source'
      ]]);
    } else {
      // Asegurar header si alguien lo borró
      const h = reviews.getRange(1, 1, 1, 7).getValues()[0] || [];
      const expected = ['reviewId', 'number', 'rating', 'author', 'text', 'publishedAt', 'source'];
      let needs = false;
      for (let i = 0; i < expected.length; i++) {
        if (String(h[i] || '') !== expected[i]) { needs = true; break; }
      }
      if (needs) reviews.getRange(1, 1, 1, 7).setValues([expected]);
    }
  });
}

function getMeta_() {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName('Meta');
    if (!sh) return { placeUrl: '', totalCount: 0 };

    const placeUrl = String(sh.getRange('A2').getValue() || '');
    const totalCount = Number(sh.getRange('B2').getValue() || 0) || 0;

    return { placeUrl, totalCount };
  });
}

function setMeta_(obj) {
  return withLock_(() => {
    const { placeUrl, totalCount } = obj || {};
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName('Meta');
    if (!sh) {
      // por seguridad si alguien llama sin ensure
      sh = ss.insertSheet('Meta');
      sh.getRange('A1').setValue('placeUrl');
      sh.getRange('B1').setValue('totalCount');
      sh.getRange('B2').setValue(0);
    }

    if (placeUrl !== undefined) sh.getRange('A2').setValue(String(placeUrl || ''));
    if (totalCount !== undefined) sh.getRange('B2').setValue(Number(totalCount || 0));
  });
}

function writeWindow_(rows) {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName('GlowMetrics');
    if (!sh) throw new Error('Falta hoja GlowMetrics. Ejecuta ensureSheets_ primero.');

    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 7).clearContent();

    const safeRows = Array.isArray(rows) ? rows : [];
    const data = safeRows.map(r => ([
      (r && r.reviewId) ? String(r.reviewId) : '',
      Number((r && r.number) || 0) || 0,
      Number((r && r.rating) || 0) || 0,
      (r && r.author) ? String(r.author) : '',
      (r && r.text) ? String(r.text) : '',
      (r && r.publishedAt) ? String(r.publishedAt) : '',
      (r && r.source) ? String(r.source) : ''
    ]));

    if (data.length > 0) {
      sh.getRange(2, 1, data.length, 7).setValues(data);
    }
  });
}

function readWindow_() {
  return withLock_(() => {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName('GlowMetrics');
    if (!sh) return [];

    const last = sh.getLastRow();
    if (last <= 1) return [];

    const values = sh.getRange(2, 1, last - 1, 7).getValues();

    // Filtra filas totalmente vacías
    const out = [];
    for (const r of values) {
      const reviewId = r[0];
      const number = r[1];
      const rating = r[2];
      const author = r[3];
      const text = r[4];
      const publishedAt = r[5];
      const source = r[6];

      const allEmpty =
        (reviewId === '' || reviewId == null) &&
        (author === '' || author == null) &&
        (text === '' || text == null) &&
        (publishedAt === '' || publishedAt == null);

      if (allEmpty) continue;

      out.push({
        reviewId: String(reviewId || ''),
        number: Number(number || 0) || 0,
        rating: Number(rating || 0) || 0,
        author: String(author || ''),
        text: String(text || ''),
        publishedAt: String(publishedAt || ''),
        source: String(source || '')
      });
    }
    return out;
  });
}
