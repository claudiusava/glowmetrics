/** =========================
 * LÓGICA PROGRAMADA (TRIGGERS)
 * ========================= */

// Esta función es la que se ejecuta 5 veces al día vía trigger.
// Aquí SÍ se llama SerpApi si hace falta.
function scheduledSerpApiCheck() {
  ensureSheets_();

  const meta = getMeta_();
  const previousTotal = Number(meta.totalCount || 0);
  const placeUrl = meta.placeUrl || PLACE_URL;

  const currentTotal = getSerpApiTotalReviews_();
  if (currentTotal == null) {
    console.error('scheduledSerpApiCheck: no se pudo obtener total de SerpApi.');
    return { updated: false, totalCount: previousTotal, reviews: readWindow_() };
  }

  if (currentTotal > previousTotal) {
    const diff = currentTotal - previousTotal;
    const toFetch = Math.min(diff, INITIAL_WINDOW_SIZE);

    const newOnes = fetchReviewsFromSerpApi_(toFetch);
    const windowBefore = readWindow_();
    const merged = dedupeById_([...newOnes, ...windowBefore]).slice(0, INITIAL_WINDOW_SIZE);
    const renumbered = assignNumbers_(merged, currentTotal);

    writeWindow_(renumbered);
    setMeta_({ placeUrl, totalCount: currentTotal });

    return { updated: true, totalCount: currentTotal, reviews: renumbered };
  }

  // Sin cambios
  return { updated: false, totalCount: currentTotal, reviews: readWindow_() };
}

/** =========================
 * UTILIDADES
 * ========================= */
function toIso_(value) {
  try {
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(value))) return String(value);
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (e) {}
  return new Date().toISOString();
}

function appendQuery_(url, params) {
  const hasQ = url.includes('?');
  const q = Object.keys(params).map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join('&');
  return url + (hasQ ? '&' : '?') + q;
}

function assignNumbers_(reviewsAscByTime, currentTotal) {
  return reviewsAscByTime.map((r, i) => ({ ...r, number: currentTotal - i }));
}

function dedupeById_(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const id = x.reviewId || JSON.stringify(x);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(x);
    }
  }
  return out;
}
