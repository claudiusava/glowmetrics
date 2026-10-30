// Lógica del registro de limpieza: cuánto falta para cada tarea, cuánto "se ha ensuciado" y a quién le toca.
// Funciones puras (no tocan la pantalla), para poder probarlas con datos reales.

export interface CleaningTask { id: string; name: string; icon: string; everyDays: number; }
export interface CleaningEntry { id: string; task: string; who: string; date: string; note: string; createdAt: string; }

/** none: sin registros · ok: de sobra · soon: se acerca · due: toca hoy · late: atrasada */
export type CleaningLevel = 'none' | 'ok' | 'soon' | 'due' | 'late';

export interface TaskState {
  last: CleaningEntry | null;
  days: number | null;      // días desde la última vez
  daysLeft: number | null;  // días que faltan para que toque (0 = hoy, negativo = atrasada)
  level: CleaningLevel;
  ratio: number;            // 0 = recién limpio, 1 = le toca (o más): lo "sucio" que está
  ago: string;              // "Hoy", "Ayer", "Hace 5 días"...
  status: string;           // "Faltan 4 días", "Toca hoy", "Atrasada 3 días"...
}

/** Hoy en la zona horaria del equipo, como "AAAA-MM-DD". */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Cualquier fecha que llegue (texto "AAAA-MM-DD", fecha larga...) como "AAAA-MM-DD"; vacío si no se entiende. */
export function normalizeDate(v: string): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : todayIso(d);
}

/** Días enteros entre dos fechas "AAAA-MM-DD" (to - from). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** El apunte más reciente de una tarea (por fecha; a igualdad, el último que se apuntó). */
export function lastEntry(entries: CleaningEntry[], taskId: string): CleaningEntry | null {
  let best: CleaningEntry | null = null;
  for (const e of entries) {
    if (e.task !== taskId || !VALID_DATE.test(e.date)) continue; // un apunte sin fecha legible no cuenta
    if (!best || e.date > best.date || (e.date === best.date && e.createdAt > best.createdAt)) best = e;
  }
  return best;
}

export function agoText(days: number): string {
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days <= 14) return `Hace ${days} días`;
  if (days <= 60) return `Hace ${Math.floor(days / 7)} semanas`;
  const m = Math.floor(days / 30);
  return `Hace ${m} ${m === 1 ? 'mes' : 'meses'}`;
}

/** Cuántos días antes de que toque se avisa de que "se acerca" (un cuarto del plazo, mínimo 1). */
export function soonDays(task: CleaningTask): number {
  return Math.max(1, Math.round(task.everyDays * 0.25));
}

export function statusText(daysLeft: number): string {
  if (daysLeft > 1) return `Faltan ${daysLeft} días`;
  if (daysLeft === 1) return 'Toca mañana';
  if (daysLeft === 0) return 'Toca hoy';
  const late = -daysLeft;
  return `Atrasada ${late} ${late === 1 ? 'día' : 'días'}`;
}

/** Estado de una tarea: cuánto falta, qué nivel de aviso y lo "sucia" que está (0 a 1). */
export function taskState(task: CleaningTask, entries: CleaningEntry[], today: string): TaskState {
  const last = lastEntry(entries, task.id);
  if (!last) return { last: null, days: null, daysLeft: null, level: 'none', ratio: 0, ago: 'Sin registros', status: 'Sin registros' };
  const days = Math.max(0, daysBetween(last.date, today));
  const daysLeft = task.everyDays - days;
  const level: CleaningLevel = daysLeft < 0 ? 'late' : daysLeft === 0 ? 'due' : daysLeft <= soonDays(task) ? 'soon' : 'ok';
  const ratio = Math.min(1, days / task.everyDays);
  return { last, days, daysLeft, level, ratio, ago: agoText(days), status: statusText(daysLeft) };
}

/**
 * Color de la barra de suciedad: de un verde agua (recién limpio) a amarillo y naranja
 * a medida que se acerca el día; rojo si ya se ha pasado.
 */
export function dirtColor(s: TaskState): string {
  if (s.level === 'none') return '#cbd5e1';
  if (s.level === 'late') return '#e11d48';
  const hue = Math.round(165 - s.ratio * 145); // 165 (agua) -> 20 (naranja)
  return `hsl(${hue}, 72%, 48%)`;
}

/** Tareas que hay que hacer ya (hoy toca o van atrasadas), las más atrasadas primero. */
export function todoNow(tasks: CleaningTask[], entries: CleaningEntry[], today: string): { task: CleaningTask; state: TaskState }[] {
  return tasks
    .map(task => ({ task, state: taskState(task, entries, today) }))
    .filter(x => x.state.level === 'due' || x.state.level === 'late')
    .sort((a, b) => (a.state.daysLeft ?? 0) - (b.state.daysLeft ?? 0));
}

/**
 * A quién le toca: quien lleve MENOS de su parte justa en los últimos `windowDays` días
 * (la parte justa sale de `shares`, p. ej. por horas trabajadas). En caso de empate, quien
 * lleve más tiempo sin hacer ESA tarea. Si siguen empatadas, no se sugiere a nadie.
 */
export function suggestWho(
  entries: CleaningEntry[], staff: string[], shares: Record<string, number>,
  taskId: string, today: string, windowDays = 90,
): string | null {
  if (staff.length === 0) return null;
  const inWindow = entries.filter(e => staff.includes(e.who) && VALID_DATE.test(e.date)
    && daysBetween(e.date, today) <= windowDays && daysBetween(e.date, today) >= 0);
  const total = inWindow.length;
  const sumShares = staff.reduce((s, p) => s + (shares[p] || 0), 0) || staff.length;

  const deficit: Record<string, number> = {};
  for (const p of staff) {
    const share = (shares[p] || (sumShares === staff.length ? 1 : 0)) / sumShares;
    const done = inWindow.filter(e => e.who === p).length;
    deficit[p] = share * total - done;
  }
  const max = Math.max(...staff.map(p => deficit[p]));
  let tied = staff.filter(p => Math.abs(deficit[p] - max) < 1e-9);
  if (tied.length === 1) return tied[0];

  // Empate: quien más tiempo lleve sin hacer esta tarea (o nunca la ha hecho).
  const lastOf = (p: string) => lastEntry(entries.filter(e => e.who === p), taskId)?.date ?? '0000-00-00';
  const oldest = tied.map(lastOf).reduce((a, b) => (a < b ? a : b));
  tied = tied.filter(p => lastOf(p) === oldest);
  return tied.length === 1 ? tied[0] : null;
}

export interface ShareRow { who: string; count: number; pct: number; target: number; }

/** Reparto de los últimos `windowDays` días: lo que ha hecho cada persona y lo que le corresponde. */
export function shareStats(
  entries: CleaningEntry[], staff: string[], shares: Record<string, number>, today: string, windowDays = 90,
): { total: number; rows: ShareRow[] } {
  const inWindow = entries.filter(e => staff.includes(e.who) && VALID_DATE.test(e.date)
    && daysBetween(e.date, today) <= windowDays && daysBetween(e.date, today) >= 0);
  const total = inWindow.length;
  const sum = staff.reduce((a, p) => a + (shares[p] || 0), 0) || staff.length;
  const rows = staff.map(who => ({
    who,
    count: inWindow.filter(e => e.who === who).length,
    pct: total ? Math.round((inWindow.filter(e => e.who === who).length / total) * 100) : 0,
    target: Math.round((((shares[who] || (sum === staff.length ? 1 : 0)) / sum) * 100)),
  }));
  return { total, rows };
}
