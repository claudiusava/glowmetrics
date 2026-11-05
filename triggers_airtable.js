function setupAirtableKpiTriggers() {
  // Borra triggers previos de este job para evitar duplicados
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    if (t.getHandlerFunction() === 'airtableKpiJob') {
      ScriptApp.deleteTrigger(t);
    }
  }

  // 13:00 Madrid
  ScriptApp.newTrigger('airtableKpiJob')
    .timeBased()
    .everyDays(1)
    .atHour(13)
    .nearMinute(0)
    .create();

  // 19:00 Madrid
  ScriptApp.newTrigger('airtableKpiJob')
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .nearMinute(0)
    .create();
}

function airtableKpiJob() {
  var centerId = 'ALCORCON';

  try {
    // Lee Airtable (sin usar la caché) y guarda el snapshot, salvo que la lectura no sea creíble
    var r = refreshAirtableSnapshot_(centerId);
    console.log(r.saved ? 'airtableKpiJob OK:' : 'airtableKpiJob: lectura descartada, se conserva el dato anterior:',
      JSON.stringify(r.stats));
    return;
  } catch (e) {
    console.error('airtableKpiJob ERROR:', e);

    // Si no hay snapshot, crea uno default (o reemplázalo siempre, tú eliges)
    var snap = null;
    try { snap = readAirtableSnapshot_(centerId); } catch (err) {}

    if (!snap) {
      saveAirtableSnapshot_(centerId, { pct: 32.15, total: 0, citadas: 0 });
    }
  }
}

