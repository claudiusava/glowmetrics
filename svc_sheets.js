/** =========================
 * PERSISTENCIA (Sheets)
 * ========================= */
function ensureSheets_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let meta = ss.getSheetByName('Meta');
  if (!meta) {
    meta = ss.insertSheet('Meta');
    meta.getRange('A1').setValue('placeUrl');
    meta.getRange('B1').setValue('totalCount');
  }

  let reviews = ss.getSheetByName('Reviews');
  if (!reviews) {
    reviews = ss.insertSheet('Reviews');
    reviews.getRange(1, 1, 1, 7)
      .setValues([['reviewId', 'number', 'rating', 'author', 'text', 'publishedAt', 'source']]);
  }
}

function getMeta_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Meta');
  const placeUrl = sh.getRange('A2').getValue();
  const totalCount = Number(sh.getRange('B2').getValue() || 0);
  return { placeUrl, totalCount };
}

function setMeta_({ placeUrl, totalCount }) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Meta');
  if (placeUrl !== undefined) sh.getRange('A2').setValue(placeUrl);
  if (totalCount !== undefined) sh.getRange('B2').setValue(Number(totalCount || 0));
}

function writeWindow_(rows) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Reviews');
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 7).clearContent();

  const data = rows.map(r => [
    r.reviewId || '',
    Number(r.number || 0),
    Number(r.rating || 0),
    r.author || '',
    r.text || '',
    r.publishedAt || '',
    r.source || ''
  ]);

  if (data.length > 0) {
    sh.getRange(2, 1, data.length, 7).setValues(data);
  }
}

function readWindow_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Reviews');
  const last = sh.getLastRow();
  if (last <= 1) return [];
  const values = sh.getRange(2, 1, last - 1, 7).getValues();
  return values.map(r => ({
    reviewId: r[0],
    number: Number(r[1]),
    rating: Number(r[2]),
    author: r[3],
    text: r[4],
    publishedAt: r[5],
    source: r[6]
  }));
}
