// Mensaje que acompaña a la escala del indicador: cambia según el tramo de color en el que estamos.
// Función pura (no toca la pantalla) para poder probarla.

export interface KpiMessage { text: string; color: string; }

// Mismos tramos que los colores de la escala (de 2 en 2 puntos). `color` es la versión oscura del
// color del tramo, para que el texto se lea bien sobre blanco.
const BANDS: { from: number; text: string; color: string }[] = [
  { from: 40, text: '¡Objetivo superado! Mantened este nivel', color: '#15803d' },
  { from: 38, text: '¡Casi en el 40 %! Un último empujón', color: '#1d7a4f' },
  { from: 36, text: 'Vamos bien, pero hay que llegar al 40 %', color: '#7a6f12' },
  { from: 34, text: 'Podemos más: ¡cada lead cuenta!', color: '#a16207' },
  { from: 32, text: 'Esto está flojo: toca mejorar ya', color: '#b45309' },
  { from: 30, text: 'Alerta: hay que subir este porcentaje', color: '#b91c1c' },
  { from: -Infinity, text: 'Muy bajo: ¡hoy toca recuperar leads!', color: '#991b1b' },
];

/** El mensaje del tramo actual; nada si todavía no hay leads (el 0 % no significa nada). */
export function kpiMessage(pct: number, total: number): KpiMessage | null {
  if (!(total > 0) || !isFinite(pct)) return null;
  const b = BANDS.find(x => pct >= x.from)!;
  return { text: b.text, color: b.color };
}
