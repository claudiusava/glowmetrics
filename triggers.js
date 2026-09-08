function setupDailyReviewTrigger() {
  // Borra triggers existentes de esta misma función para evitar duplicados
  const triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    if (t.getHandlerFunction() === 'dailyReviewsJob') {
      ScriptApp.deleteTrigger(t);
    }
  }

  // Crea trigger diario (por defecto lo pondrá en una hora aproximada)
  ScriptApp.newTrigger('dailyReviewsJob')
    .timeBased()
    .everyDays(1)
    .create();
}

// Job diario: ejecuta el check 1 vez al día, con guard por si el trigger se duplica
function dailyReviewsJob() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var dayKey =
    now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');

  var lastRun = props.getProperty('DAILY_REVIEWS_LAST_RUN');
  if (lastRun === dayKey) {
    console.log('dailyReviewsJob: ya ejecutado hoy (' + dayKey + ').');
    return;
  }

  // Ejecuta
  var result = scheduledSerpApiCheck();
  props.setProperty('DAILY_REVIEWS_LAST_RUN', dayKey);

  console.log('dailyReviewsJob OK:', JSON.stringify({
    updated: result && result.updated,
    totalCount: result && result.totalCount
  }));
}
