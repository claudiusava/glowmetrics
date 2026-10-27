export interface Review {
  reviewId: string;
  number: number;
  rating: number;
  author: string;
  text: string;
  publishedAt: string;
  source: string;
}

export interface ReviewsResponse {
  totalCount: number;
  reviews: Review[];
  updated?: boolean;
  newReviewsCount?: number;
}

// Respuesta de la ruta `bootstrap`: lo que necesita la pantalla al abrir, en
// una sola petición. Cada parte llega null si falló en el servidor (el resto
// sigue siendo válido). `error` aparece si el backend no conoce la ruta.
export interface ReviewsBundle {
  ready: boolean;
  totalCount: number;
  reviews: Review[];
  newReviewsCount: number;
}

// Respuesta del refresco manual de reseñas (palabra secreta "reseñas").
export interface ReviewsRefresh extends ReviewsBundle {
  error?: string;     // el servidor no conoce la ruta (versión antigua)
  refreshed: boolean; // false = ya se había hecho hace poco (cooldown)
  updated: boolean;   // true = el sync ha encontrado reseñas nuevas
}

export interface BootstrapResponse {
  reviews: ReviewsBundle | null;
  kpi: AirtableKpi | null;
  goal: MonthlyGoal | null;
  history: MonthlyHistoryEntry[] | null;
  tips: string[] | null;
  error?: string;
}

export interface MonthlyGoal {
  count: number;
  goal: number;
  monthKey: string;
}

// Coste de la publicidad por lead y por cita (con y sin IVA), con los leads de los últimos N días.
export interface AdCost {
  windowDays: number;
  leads: number;
  citadas: number;
  spend: number;       // gasto al mes sin IVA
  spendVat: number;    // gasto al mes con IVA
  perLead: number | null;
  perLeadVat: number | null;
  perCita: number | null;
  perCitaVat: number | null;
}

export interface AirtableKpi {
  cost?: AdCost; // puede faltar (copia antigua o aún sin calcular)
  pct: number;
  total: number;
  citadas: number;
  stale: boolean;
  updatedAt: string;
  refreshed?: boolean;
}

export interface MonthlyHistoryEntry {
  monthKey: string;
  count: number | null;
  goal?: number; // objetivo que valía ese mes (puede faltar en copias antiguas)
  met: boolean | null;
}

export interface Note {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface AddNoteResult {
  ok?: boolean;
  error?: string;
  notes: Note[];
}

// Lista de espera de clientas (ver svc_waitlist.js).
export interface WaitItem {
  id: string;
  name: string;
  zones: string;
  // Días de lunes a viernes: letras L M X J V (X = miércoles); vacío = cualquiera.
  days: string;
  // Franja: M = mañana, T = tarde; vacío = cualquiera.
  parts: string;
  detail: string;
  // Técnico preferido: L = Laura, E = Elena; vacío = le es indiferente.
  tech: string;
  createdAt: string;
  updatedAt: string;
}

export interface WaitlistResult {
  ok?: boolean;
  error?: string;
  id?: string;
  item?: WaitItem;   // lo que se ha guardado (altas y cambios)
  items?: WaitItem[]; // solo en respuestas de error
}

// Ranking mensual de reseñas de Google de la franquicia (ver ranking/README.md).
export interface RankingRow {
  puesto: number;
  nombre: string;
  slug: string;
  reseñas: number;
  nota: number | null;
  es_nuestro: boolean;
}

export interface RankingCapture {
  fecha: string; // AAAA-MM-DD
  centros_leidos: number;
  centros_total: number;
  ranking: RankingRow[];
}
