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
  VIEW_ID: 'viw43MlTmyROPwIXD', // vista "Grid view" (la de siempre). La API respeta los filtros de la vista: si las chicas ponen uno, la red de seguridad de svc_airtable.js descarta lecturas con >10 % menos leads
  FIELD_NAME: 'Field 5',        // campo que contiene "CITADA"
  CACHE_SECS: 900
});

// Publicidad de la franquicia: gasto fijo al mes (sin IVA) y IVA, para el coste por lead / por cita.
// El coste se calcula con los leads que han entrado en los últimos WINDOW_DAYS días (siempre
// comparable, a cualquier hora del mes). Si el gasto cambia, se cambia aquí.
const AD_SPEND = Object.freeze({
  MONTHLY_EUR: 750,
  VAT_RATE: 0.21,
  WINDOW_DAYS: 30
});

// Limpieza del local (ver svc_cleaning.js). Cada tarea "toca" cuando pasan `everyDays` días desde
// la última vez, y se marca atrasada si se pasa de ahí. `shares` son las horas semanales de cada
// persona: de ahí sale su parte justa del reparto. `owner` (opcional) es la responsable fija de la
// tarea: la pantalla la muestra siempre y le sugiere a ella; cualquiera puede apuntarla igualmente.
const CLEANING_STAFF = Object.freeze(['Elena', 'Laura']);
const CLEANING_SHARES = Object.freeze({ Elena: 40, Laura: 25 });
const CLEANING_TASKS = Object.freeze([
  { id: 'recepcion', name: 'Polvo recepción', icon: '🛋️', everyDays: 5 },
  { id: 'cabina1', name: 'Polvo cabina 1', icon: '🚪', everyDays: 3, owner: 'Laura' },
  { id: 'cabina2', name: 'Polvo cabina 2', icon: '🚪', everyDays: 3, owner: 'Elena' },
  { id: 'bano', name: 'Baño', icon: '🚽', everyDays: 10 },
  { id: 'cristales', name: 'Cristales', icon: '🪟', everyDays: 60 }
]);

// Ofertas de campaña con unidades limitadas por centro (ver svc_promos.js). El límite de cada una es lo que
// permite vender la franquicia en este centro; la web enseña cuántas quedan y deja apuntar cada venta.
// `section` agrupa las tarjetas en pantalla, `group` es el tratamiento y `label` la variante (sesiones o precio).
// `closed: true` = oferta cerrada (la franquicia la ha agotado): sigue visible con lo vendido, pero deshabilitada.
// Para reabrirla basta con quitar esa marca.
const PROMO_CAMPAIGN = Object.freeze({ name: 'Black Friday', from: '2026-11-18', to: '2026-11-30' });
const PROMO_OFFERS = Object.freeze([
  // Mujer
  { id: 'mujer-cuerpo-3', section: 'mujer', group: 'Cuerpo completo', label: '3 sesiones', price: '195 €', limit: 15 },
  { id: 'mujer-cuerpo-2', section: 'mujer', group: 'Cuerpo completo', label: '2 sesiones', price: '135 €', limit: 20 },
  { id: 'mujer-cuerpo-1', section: 'mujer', group: 'Cuerpo completo', label: '1 sesión', price: '70 €', limit: 50 },
  { id: 'mujer-piernas-3', section: 'mujer', group: 'Piernas completas', label: '3 sesiones', price: '87 €', limit: 50 },
  { id: 'mujer-piernas-2', section: 'mujer', group: 'Piernas completas', label: '2 sesiones', price: '55 €', limit: 50 },
  { id: 'mujer-piernas-1', section: 'mujer', group: 'Piernas completas', label: '1 sesión', price: '19 €', limit: 50 },
  { id: 'mujer-ipa-3', section: 'mujer', group: 'Ingles + piernas + axilas', label: '3 sesiones', price: '125 €', limit: 50 },
  { id: 'mujer-ipa-2', section: 'mujer', group: 'Ingles + piernas + axilas', label: '2 sesiones', price: '86 €', limit: 50 },
  { id: 'mujer-ipa-1', section: 'mujer', group: 'Ingles + piernas + axilas', label: '1 sesión', price: '25 €', limit: 50 },
  // Hombre
  { id: 'hombre-cuerpo-3', section: 'hombre', group: 'Cuerpo completo', label: '3 sesiones', price: '240 €', limit: 15 },
  { id: 'hombre-cuerpo-2', section: 'hombre', group: 'Cuerpo completo', label: '2 sesiones', price: '165 €', limit: 25 },
  { id: 'hombre-cuerpo-1', section: 'hombre', group: 'Cuerpo completo', label: '1 sesión', price: '90 €', limit: 50 },
  { id: 'hombre-piernas-3', section: 'hombre', group: 'Piernas completas', label: '3 sesiones', price: '110 €', limit: 50 },
  { id: 'hombre-piernas-2', section: 'hombre', group: 'Piernas completas', label: '2 sesiones', price: '76 €', limit: 50 },
  { id: 'hombre-piernas-1', section: 'hombre', group: 'Piernas completas', label: '1 sesión', price: '24,90 €', limit: 50 },
  { id: 'hombre-espalda-3', section: 'hombre', group: 'Espalda completa + tórax + hombros', label: '3 sesiones', price: '136 €', limit: 50 },
  { id: 'hombre-espalda-2', section: 'hombre', group: 'Espalda completa + tórax + hombros', label: '2 sesiones', price: '96 €', limit: 50 },
  { id: 'hombre-espalda-1', section: 'hombre', group: 'Espalda completa + tórax + hombros', label: '1 sesión', price: '40 €', limit: 50 },
  // Ofertas de 3 €, 2 € y 1 € (25 unidades de cada precio), debajo y con las mujeres a la izquierda y los hombres a la derecha
  { id: 'mini-mujer-ingles-3', section: 'minis-mujer', group: 'Ingles normales', label: 'a 3 €', price: '', limit: 25 },
  { id: 'mini-mujer-ingles-2', section: 'minis-mujer', group: 'Ingles normales', label: 'a 2 €', price: '', limit: 25, closed: true },
  { id: 'mini-mujer-ingles-1', section: 'minis-mujer', group: 'Ingles normales', label: 'a 1 €', price: '', limit: 25, closed: true },
  { id: 'mini-mujer-axilas-3', section: 'minis-mujer', group: 'Axilas', label: 'a 3 €', price: '', limit: 25 },
  { id: 'mini-mujer-axilas-2', section: 'minis-mujer', group: 'Axilas', label: 'a 2 €', price: '', limit: 25, closed: true },
  { id: 'mini-mujer-axilas-1', section: 'minis-mujer', group: 'Axilas', label: 'a 1 €', price: '', limit: 25, closed: true },
  { id: 'mini-hombre-axilas-3', section: 'minis-hombre', group: 'Axilas', label: 'a 3 €', price: '', limit: 25 },
  { id: 'mini-hombre-axilas-2', section: 'minis-hombre', group: 'Axilas', label: 'a 2 €', price: '', limit: 25, closed: true },
  { id: 'mini-hombre-axilas-1', section: 'minis-hombre', group: 'Axilas', label: 'a 1 €', price: '', limit: 25, closed: true }
]);

// Google Sheets / negocio
const SPREADSHEET_ID = '1o-z4-0XLKpmV_houX06G4DgAeImNWHkgoHPJBXxFZbQ';
const PLACE_URL = 'https://www.google.com/maps/place/SinVello!+Alcorc%C3%B3n+%7C+Depilaci%C3%B3n+L%C3%A1ser+Diodo/@40.35219,-3.8246795,15z/data=!4m6!3m5!1s0xd4189bcbbfacd33:0x4a3bdccdbd719687!8m2!3d40.35219!4d-3.8246795!16s%2Fg%2F11vlpq89hn?entry=ttu&g_ep=EgoyMDI1MTAxNC4wIKXMDSoASAFQAw%3D%3D';
const PLACE_ID = 'ChIJM836u7yJQQ0Rh5Zxvc3cO0o';

const INITIAL_WINDOW_SIZE = 20;
// Objetivo mensual de reseñas. Cada objetivo vale desde el mes indicado ("AAAA-MM")
// hasta que empieza el siguiente: así los meses pasados siguen evaluándose con el
// objetivo que tenían entonces (cambiar el objetivo no pone en rojo el histórico).
// Para cambiarlo en el futuro: añadir una línea con el primer mes en que vale.
const MONTHLY_GOAL_SCHEDULE = [
  { from: '0000-00', goal: 20 },
  { from: '2026-11', goal: 25 }  // subido a 25 desde noviembre de 2026 (media de los últimos 11 meses: 25)
];

/** Objetivo de reseñas que valía en el mes `monthKey` ("AAAA-MM"). */
function goalForMonth_(monthKey) {
  let goal = MONTHLY_GOAL_SCHEDULE[0].goal;
  for (let i = 0; i < MONTHLY_GOAL_SCHEDULE.length; i++) {
    if (MONTHLY_GOAL_SCHEDULE[i].from <= String(monthKey)) goal = MONTHLY_GOAL_SCHEDULE[i].goal;
  }
  return goal;
}

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
