import type { Env, Reservation } from '../types';
import { listEvents, CLEANING_COLOR_ID } from '../google/calendar';
import { activeReservations } from '../storage/db';
import { addDays, nextPossibleCheckin, overlapsInclusive } from '../util/dates';

/**
 * Kontrola dostupnosti termínu.
 *
 * Pravidlo úklidové rezervy: po každém pobytu je blokovaný den odjezdu + další 2 dny
 * (CLEANING_BLOCK_DAYS = 3 celkem). Termín tedy koliduje i tehdy, když se "jen dotýká"
 * cizí úklidové mezery. Kontroluje se proti kalendáři (zdroj pravdy, může obsahovat i
 * ručně založené pobyty) i proti databázi (kvůli DRY_RUN, kdy se do kalendáře nezapisuje).
 */

export interface Conflict {
  source: 'calendar' | 'db';
  label: string;
  start: string;
  end: string;
}

export interface AvailabilityResult {
  available: boolean;
  conflicts: Conflict[];
  /** Nejbližší možný checkin, pokud je termín obsazený a jde to spočítat. */
  suggestion: string | null;
}

export async function checkAvailability(
  env: Env,
  checkin: string,
  checkout: string,
  opts: { ignoreReservationId?: number } = {}
): Promise<AvailabilityResult> {
  const cleaningDays = Number(env.CLEANING_BLOCK_DAYS || '3');
  const conflicts: Conflict[] = [];

  // Okno pro dotaz: termín ± rezerva, ať zachytíme i sousední pobyty.
  const windowStart = addDays(checkin, -(cleaningDays + 2));
  const windowEnd = addDays(checkout, cleaningDays + 3);

  // požadovaný termín včetně vlastní úklidové rezervy
  const wantStart = checkin;
  const wantEnd = addDays(checkout, cleaningDays - 1);

  let events: Awaited<ReturnType<typeof listEvents>> = [];
  try {
    events = await listEvents(env, windowStart, windowEnd);
  } catch (err) {
    // Bez kalendáře nemůžeme dostupnost potvrdit — raději termín odmítnout než dvojitě obsadit.
    throw new Error(`Nepodařilo se načíst kalendář pro kontrolu dostupnosti: ${(err as Error).message}`);
  }

  for (const ev of events) {
    const isCleaning = ev.colorId === CLEANING_COLOR_ID || /^ÚKLID/i.test(ev.summary);
    // pobyt v kalendáři rozšiřujeme o úklid; úklidový blok bereme, jak je
    const evEnd = isCleaning ? ev.end : addDays(ev.end, cleaningDays - 1);
    if (overlapsInclusive(wantStart, wantEnd, ev.start, evEnd)) {
      conflicts.push({ source: 'calendar', label: ev.summary || '(bez názvu)', start: ev.start, end: evEnd });
    }
  }

  for (const r of await activeReservations(env)) {
    if (opts.ignoreReservationId && r.id === opts.ignoreReservationId) continue;
    // událost už je v kalendáři → nepočítat konflikt dvakrát
    if (r.calendar_event_id && !r.calendar_event_id.includes('dryrun')) continue;
    const rEnd = addDays(r.checkout, cleaningDays - 1);
    if (overlapsInclusive(wantStart, wantEnd, r.checkin, rEnd)) {
      conflicts.push({
        source: 'db',
        label: `${r.status === 'provisional' ? 'PROVIZORNÍ' : 'rezervace'} – ${r.guest_name ?? r.guest_email}`,
        start: r.checkin,
        end: rEnd,
      });
    }
  }

  let suggestion: string | null = null;
  if (conflicts.length) {
    const latestEnd = conflicts
      .map((c) => c.end)
      .sort()
      .at(-1)!;
    suggestion = addDays(latestEnd, 1);
  }

  return { available: conflicts.length === 0, conflicts, suggestion };
}

/** Nejbližší možný checkin po daném pobytu (pro texty a avízo na úklid). */
export function nextCheckinAfter(env: Env, reservation: Reservation): string {
  return nextPossibleCheckin(reservation.checkout, Number(env.CLEANING_BLOCK_DAYS || '3'));
}
