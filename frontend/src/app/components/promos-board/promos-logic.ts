// Lógica de las ofertas con unidades limitadas: cuántas quedan, cuándo avisar y cómo se agrupan en pantalla.
// Funciones puras (no tocan la pantalla), para poder probarlas con datos reales.

import { PromoOffer, PromoSection } from '../../models/review.model';

/** ok: quedan de sobra · low: quedan pocas · out: agotada */
export type PromoLevel = 'ok' | 'low' | 'out';

/** Unidades que quedan (nunca negativas, aunque se haya vendido de más o se haya bajado el límite). */
export function remaining(limit: number, sold: number): number {
  return Math.max(0, limit - Math.max(0, sold));
}

/** "Pocas" = el 20 % del límite, y como mínimo 3 (15 uds → 3, 25 → 5, 50 → 10). */
export function lowThreshold(limit: number): number {
  return Math.max(3, Math.ceil(limit * 0.2));
}

export function promoLevel(limit: number, sold: number): PromoLevel {
  const left = remaining(limit, sold);
  if (left <= 0) return 'out';
  return left <= lowThreshold(limit) ? 'low' : 'ok';
}

export const SECTION_TITLES: Record<PromoSection, string> = {
  mujer: 'Mujer',
  hombre: 'Hombre',
  minis: 'Ofertas de 3 €, 2 € y 1 €',
};

export interface PromoCard { offer: PromoOffer; sold: number; left: number; level: PromoLevel; pct: number; }
export interface PromoGroup { name: string; cards: PromoCard[]; }
export interface PromoSectionView { section: PromoSection; title: string; groups: PromoGroup[]; sold: number; limit: number; }

/** Las ofertas agrupadas como en el cartel: sección → tratamiento → variantes (en el orden de la configuración). */
export function buildSections(offers: PromoOffer[], sold: (id: string) => number): PromoSectionView[] {
  const sections: PromoSectionView[] = [];
  for (const offer of offers) {
    let sec = sections.find(s => s.section === offer.section);
    if (!sec) { sec = { section: offer.section, title: SECTION_TITLES[offer.section] ?? offer.section, groups: [], sold: 0, limit: 0 }; sections.push(sec); }
    let group = sec.groups.find(g => g.name === offer.group);
    if (!group) { group = { name: offer.group, cards: [] }; sec.groups.push(group); }
    const s = Math.max(0, sold(offer.id));
    group.cards.push({
      offer,
      sold: s,
      left: remaining(offer.limit, s),
      level: promoLevel(offer.limit, s),
      pct: offer.limit ? Math.min(100, Math.round((s / offer.limit) * 100)) : 0,
    });
    sec.sold += Math.min(s, offer.limit);
    sec.limit += offer.limit;
  }
  return sections;
}

export interface PromoTotals { sold: number; limit: number; soldOut: number; low: number; }

export function promoTotals(sections: PromoSectionView[]): PromoTotals {
  const t: PromoTotals = { sold: 0, limit: 0, soldOut: 0, low: 0 };
  for (const sec of sections) {
    t.sold += sec.sold;
    t.limit += sec.limit;
    for (const g of sec.groups) for (const c of g.cards) {
      if (c.level === 'out') t.soldOut++;
      else if (c.level === 'low') t.low++;
    }
  }
  return t;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "Del 18 al 30 de noviembre" (o "Del 28 de noviembre al 3 de diciembre" si cruza de mes). */
export function campaignText(from: string, to: string): string {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(from) || !ok(to)) return '';
  const [d1, m1, d2, m2] = [+from.slice(8), +from.slice(5, 7) - 1, +to.slice(8), +to.slice(5, 7) - 1];
  return m1 === m2 ? `Del ${d1} al ${d2} de ${MESES[m2]}` : `Del ${d1} de ${MESES[m1]} al ${d2} de ${MESES[m2]}`;
}

/** Nombre completo de una oferta para los avisos: "Mujer · Cuerpo completo · 3 sesiones". */
export function offerName(o: PromoOffer): string {
  return o.section === 'minis' ? `${o.group} ${o.label}` : `${SECTION_TITLES[o.section] ?? o.section} · ${o.group} · ${o.label}`;
}

/** Identificador de una escritura: si se repite, el servidor sabe que es la misma y no la cuenta dos veces. */
export function newRequestId(): string {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/** Qué se le dice a la persona cuando el servidor rechaza un cambio. */
export function promoErrorText(error: string | undefined, o: PromoOffer): string {
  switch (error) {
    case 'sold-out': return `Se acaba de agotar «${offerName(o)}»: ya no quedan.`;
    case 'nothing-to-undo': return `«${offerName(o)}» no tiene ventas que deshacer.`;
    case 'invalid-number': return 'Ese número no vale: pon un entero entre 0 y el límite.';
    default: return 'No se pudo guardar el cambio.';
  }
}
