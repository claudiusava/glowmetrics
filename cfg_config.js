/*************************
 * CONFIGURACIÓN GENERAL (ESTABILIZADA)
 *************************
 * Cambios:
 * - Congela la configuración en objetos inmutables para evitar mutaciones accidentales.
 * - Centraliza límites/timeouts (sin triggers).
 * - Mantiene exactamente tus constantes y valores.
 */

// Airtable
const AIRTABLE = Object.freeze({
  BASE_ID: 'appkC8oRh7XtpKEVN',
  TABLE_ID: 'tblVS5CHe2Vjb5HRv',
  VIEW_ID: 'viw43MlTmyROPwIXD', // vista
  FIELD_NAME: 'Field 5',        // campo que contiene "CITADA"
  CACHE_SECS: 900
});

// Google Sheets / negocio
const SPREADSHEET_ID = '1o-z4-0XLKpmV_houX06G4DgAeImNWHkgoHPJBXxFZbQ';
const PLACE_URL = 'https://www.google.com/maps/place/SinVello!+Alcorc%C3%B3n+%7C+Depilaci%C3%B3n+L%C3%A1ser+Diodo/@40.35219,-3.8246795,15z/data=!4m6!3m5!1s0xd4189bcbbfacd33:0x4a3bdccdbd719687!8m2!3d40.35219!4d-3.8246795!16s%2Fg%2F11vlpq89hn?entry=ttu&g_ep=EgoyMDI1MTAxNC4wIKXMDSoASAFQAw%3D%3D';
const PLACE_ID = 'ChIJM836u7yJQQ0Rh5Zxvc3cO0o';

const INITIAL_WINDOW_SIZE = 20;
const MONTHLY_GOAL = 20;

// SerpApi
// Guarda SERPAPI_KEY en Script Properties (igual que AIRTABLE_PAT)
const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';
const SERPAPI_DAILY_LIMIT = 20; // máximo llamadas/día (seguro)

// Estabilidad / red (si tus otros archivos lo usan)
const NET = Object.freeze({
  URLFETCH_TIMEOUT_MS: 20000,
  URLFETCH_TRIES: 3,
  COOLDOWN_CHECK_MS: 3000,
  COOLDOWN_INIT_MS: 15000
});
