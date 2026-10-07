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

export interface AirtableKpi {
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
export type WaitStatus = 'pending' | 'noanswer' | 'booked';

export interface WaitItem {
  id: string;
  name: string;
  zones: string;
  // Días de lunes a viernes: letras L M X J V (X = miércoles); vacío = cualquiera.
  days: string;
  // Franja: M = mañana, T = tarde; vacío = cualquiera.
  parts: string;
  detail: string;
  status: WaitStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface WaitlistResult {
  ok?: boolean;
  error?: string;
  id?: string;
  items: WaitItem[];
}
