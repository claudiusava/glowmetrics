// Lógica pura de los repasos de clientas (sin Angular, para poder probarla con Node):
// cuándo toca cada uno, cómo se ordenan y a qué fecha se pasan al "avisarlas".
import { daysBetween } from '../cleaning-board/cleaning-logic';
import type { FollowupItem } from '../../models/review.model';

/** `due` es el día en que toca el repaso, "AAAA-MM-DD". */
export type Followup = FollowupItem;

/** Cuánto falta (o cuánto se pasó) para el repaso, y cómo pintarlo. */
export interface FollowupState {
  /** Días hasta el repaso: 0 = hoy, negativo = ya pasó. */
  days: number;
  level: 'late' | 'today' | 'soon' | 'later';
  /** "Hoy", "Mañana", "En 3 días", "Atrasado 2 días"… */
  text: string;
}

/** "Se acerca" = en los próximos 14 días. */
export const SOON_DAYS = 14;

const pad = (n: number) => String(n).padStart(2, '0');

/** Suma meses a una fecha "AAAA-MM-DD"; si el día no existe en el mes de destino, el último día de ese mes. */
export function addMonths(iso: string, months: number): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + months;
  const d = +iso.slice(8, 10);
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** Suma días a una fecha "AAAA-MM-DD". */
export function addDays(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Atajos para elegir cuándo hay que volver a contactar (se cuentan desde hoy). */
export interface Preset { label: string; days?: number; months?: number; }
export const PRESETS: readonly Preset[] = [
  { label: 'En 2 semanas', days: 14 },
  { label: 'En 1 mes', months: 1 },
  { label: 'En 6 meses', months: 6 },
  { label: 'En 1 año', months: 12 },
];

export function presetDate(p: Preset, today: string): string {
  return p.months != null ? addMonths(today, p.months) : addDays(today, p.days ?? 0);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}

export function followupState(f: Followup, today: string): FollowupState {
  const days = daysBetween(today, f.due);
  if (days < 0) return { days, level: 'late', text: `Atrasado ${plural(-days, 'día', 'días')}` };
  if (days === 0) return { days, level: 'today', text: 'Hoy' };
  if (days === 1) return { days, level: 'soon', text: 'Mañana' };
  const level = days <= SOON_DAYS ? 'soon' : 'later';
  if (days < 14) return { days, level, text: `En ${days} días` };
  if (days < 60) return { days, level, text: `En ${plural(Math.round(days / 7), 'semana', 'semanas')}` };
  return { days, level, text: `En ${plural(Math.round(days / 30.4), 'mes', 'meses')}` };
}

/** Los que ya toca avisar (hoy o atrasados). */
export function dueNow(items: Followup[], today: string): Followup[] {
  return items.filter(f => f.due <= today);
}

/** El que antes toca, primero (a igual fecha, el apuntado antes). */
export function sortFollowups(items: Followup[]): Followup[] {
  return [...items].sort((a, b) => (a.due + a.createdAt).localeCompare(b.due + b.createdAt));
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "15 mar 2027" */
export function fmtDay(iso: string): string {
  return `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
}
