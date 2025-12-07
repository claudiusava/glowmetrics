/** =========================
 * TRIGGERS
 * ========================= */

// Crea 5 triggers diarios: 8:00, 11:00, 15:00, 18:00, 21:00
function createSerpApiCheckTriggers() {
  const hours = [8, 11, 15, 18, 21];

  // Borramos triggers anteriores de esta función
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'scheduledSerpApiCheckWrapper') {
      ScriptApp.deleteTrigger(t);
    }
  });

  hours.forEach(h => {
    ScriptApp.newTrigger('scheduledSerpApiCheckWrapper')
      .timeBased()
      .atHour(h)
      .nearMinute(0)
      .everyDays(1)
      .create();
  });

  console.log('Triggers creados para scheduledSerpApiCheckWrapper a las: ' + hours.join(', '));
}

// Wrapper para usar en el trigger (los triggers no pueden pasar params)
function scheduledSerpApiCheckWrapper() {
  try {
    scheduledSerpApiCheck();
  } catch (e) {
    console.error('scheduledSerpApiCheckWrapper ERROR:', e);
  }
}

function listMyTriggers() {
  const list = ScriptApp.getProjectTriggers().map(t => ({
    func: t.getHandlerFunction(),
    type: t.getEventType()
  }));
  console.log(JSON.stringify(list, null, 2));
  return list;
}

function deleteSerpApiCheckTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'scheduledSerpApiCheckWrapper') {
      ScriptApp.deleteTrigger(t);
    }
  });
  console.log('Triggers de scheduledSerpApiCheckWrapper eliminados.');
}
