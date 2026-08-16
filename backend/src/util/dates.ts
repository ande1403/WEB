/**
 * Práce s daty. Vše jako 'YYYY-MM-DD' string, počítáno v UTC půlnocích,
 * aby nikde nemohl zasáhnout letní čas.
 *
 * KLÍČOVÁ KONVENCE PROJEKTU:
 *   checkin / checkout v databázi jsou INCLUSIVE — host je v den checkoutu ještě přítomen.
 *   Google Calendar all-day událost má end.date EXCLUSIVE — proto se na konec vždy
 *   přičítá 1 den (viz toExclusiveEnd). Nikdy nepředávat checkout do API napřímo.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function assertDate(s: string, label = 'date'): string {
  if (!isDate(s)) throw new Error(`Neplatné datum (${label}): ${JSON.stringify(s)}`);
  return s;
}

export function toUtc(d: string): number {
  return Date.parse(assertDate(d) + 'T00:00:00Z');
}

export function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** Počet dní b - a (kladné = b je později). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

export function minDate(a: string, b: string): string {
  return toUtc(a) <= toUtc(b) ? a : b;
}

export function maxDate(a: string, b: string): string {
  return toUtc(a) >= toUtc(b) ? a : b;
}

/** Dnešní datum v zadané časové zóně (default Asia/Tbilisi — místní čas bytu). */
export function today(timeZone = 'Asia/Tbilisi', now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now); // en-CA dává rovnou YYYY-MM-DD
}

/** Z inclusive checkout dne udělá exclusive end.date pro Google Calendar. */
export function toExclusiveEnd(checkoutInclusive: string): string {
  return addDays(checkoutInclusive, 1);
}

/** Z exclusive end.date z Google Calendaru udělá inclusive poslední den. */
export function fromExclusiveEnd(endExclusive: string): string {
  return addDays(endExclusive, -1);
}

/**
 * Úklidový blok po pobytu: začíná dnem odjezdu a trvá `days` dní včetně
 * (default 3 → checkout, +1, +2). Vrací start a EXCLUSIVE konec pro kalendář.
 */
export function cleaningBlock(checkoutInclusive: string, days = 3): { start: string; endExclusive: string } {
  return {
    start: checkoutInclusive,
    endExclusive: addDays(checkoutInclusive, days),
  };
}

/** První den, kdy může po tomhle pobytu přijet další host. */
export function nextPossibleCheckin(checkoutInclusive: string, cleaningDays = 3): string {
  return addDays(checkoutInclusive, cleaningDays);
}

/** Překrývají se intervaly [aStart,aEnd] a [bStart,bEnd] (oba inclusive)? */
export function overlapsInclusive(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toUtc(aStart) <= toUtc(bEnd) && toUtc(bStart) <= toUtc(aEnd);
}

/** Formát data pro lidi, per jazyk. */
export function formatDate(d: string, lang: string): string {
  const [y, m, day] = d.split('-');
  switch (lang) {
    case 'cs':
    case 'pl':
      return `${Number(day)}. ${Number(m)}. ${y}`;
    case 'ru':
    case 'ka':
      return `${day}.${m}.${y}`;
    case 'he':
      return `${Number(day)}.${Number(m)}.${y}`;
    default:
      return `${y}-${m}-${day}`;
  }
}
