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

  // Evitar que el job se coma un cache malo
  try { CacheService.getScriptCache().remove('airtable_stats'); } catch (e) {}

  try {
    var stats = getAirtableStats(); // si Airtable funciona, aquí total>0
    saveAirtableSnapshot_(centerId, stats);
    console.log('airtableKpiJob OK:', JSON.stringify(stats));
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

