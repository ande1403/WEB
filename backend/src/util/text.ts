import type { Lang } from '../types';

/**
 * Ořízne citovanou historii z e-mailové odpovědi.
 * Odpovědi hostů typicky obsahují celý předchozí thread — model i heuristika by z něj
 * jinak vytáhly staré údaje (např. termín z naší vlastní odpovědi).
 */
const QUOTE_MARKERS = [
  /^-{2,}\s*Původní e[-‑]?mail\s*-{2,}/im,
  /^-{2,}\s*Forwarded message\s*-{2,}/im,
  /^On .{5,80}\s+wrote:\s*$/im,
  /^\S.{0,80}\s+napsal\(a\)?:\s*$/im,
  /^\S.{0,80}\s+odesílatel .{0,120}napsal:\s*$/im,
  /^\S.{0,80}\s+пишет:\s*$/im,
  /^_{10,}\s*$/m,
];

export function stripQuoted(body: string): string {
  let cut = body.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  let text = body.slice(0, cut);
  // odstranit řádky citace ">" a podpisový oddělovač
  text = text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
  const sig = text.indexOf('\n-- \n');
  if (sig > 40) text = text.slice(0, sig);
  return text.trim();
}

/** Odhad jazyka podle písma a typických slov. Model má přednost, tohle je fallback. */
export function guessLang(text: string): Lang {
  if (/[֐-׿]/.test(text)) return 'he';
  if (/[Ⴀ-ჿ]/.test(text)) return 'ka';
  if (/[Ѐ-ӿ]/.test(text)) return 'ru';
  const t = ` ${text.toLowerCase()} `;
  // Skóre, ne binární test — slova jako "osoby" nebo "termin" jsou česky i polsky,
  // rozhodovat se musí podle těch rozlišujících.
  let cs = 0;
  let pl = 0;
  if (/[ěščřůý]/.test(text)) cs += 2;
  if (/[ąćęłńśźż]/.test(text)) pl += 2;
  if (/\b(dobrý den|rezervace|termín|děkuji|prosím|chtěl|bych|nocí|pobyt)\b/.test(t)) cs += 2;
  if (/\b(dzień dobry|rezerwacja|proszę|chciałbym|chciałabym|nocy|pobytu|dziękuję)\b/.test(t)) pl += 2;
  if (cs > pl) return 'cs';
  if (pl > cs) return 'pl';
  if (/\b(hello|hi|booking|available|would like|nights?)\b/.test(t)) return 'en';
  return cs > 0 ? 'cs' : 'en';
}

/** Parsuje tělo e-mailu z Web3Forms (`name : …`, `email : …`, `message : …`). */
export function parseWeb3Forms(body: string): { name: string | null; email: string | null; message: string | null } | null {
  const get = (field: string): string | null => {
    const re = new RegExp(`^\\s*${field}\\s*:\\s*(.*)$`, 'im');
    const m = re.exec(body);
    return m && m[1] ? m[1].trim() : null;
  };
  const email = get('email');
  const name = get('name');
  const message = get('message');
  if (!email && !name && !message) return null;
  return { name, email: email ? email.toLowerCase() : null, message };
}

const MONTH_WORDS: Record<string, number> = {
  ledna: 1, unora: 2, února: 2, brezna: 3, března: 3, dubna: 4, kvetna: 5, května: 5,
  cervna: 6, června: 6, cervence: 7, července: 7, srpna: 8, zari: 9, září: 9,
  rijna: 10, října: 10, listopadu: 11, prosince: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Vytáhne z volného textu rozsah dat (od–do). Zvládne běžné evropské zápisy:
 * "29.10.2026 - 3.11.2026", "29. 10. – 3. 11. 2026", "2026-10-29 to 2026-11-03",
 * "od 29.10. do 3.11.2026", "29 October 2026 - 3 November 2026".
 * Vrací YYYY-MM-DD (checkout inclusive). Nejistý výsledek → null.
 */
export function extractDateRange(text: string, referenceYear: number): { from: string; to: string } | null {
  const iso = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:-|–|—|to|až|do)\s*(\d{4}-\d{2}-\d{2})/);
  if (iso) return { from: iso[1]!, to: iso[2]! };

  // d.m[.yyyy] – d.m[.yyyy]
  const eu = text.match(
    /(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*(\d{4})?\s*(?:-|–|—|až|do|to)\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*(\d{4})?/
  );
  if (eu) {
    const y2 = eu[6] ? Number(eu[6]) : referenceYear;
    const y1 = eu[3] ? Number(eu[3]) : y2;
    const from = `${y1}-${pad(Number(eu[2]))}-${pad(Number(eu[1]))}`;
    const to = `${y2}-${pad(Number(eu[5]))}-${pad(Number(eu[4]))}`;
    return { from, to };
  }

  // "29 October 2026 - 3 November 2026" / "29. října – 3. listopadu 2026"
  const words = text
    .toLowerCase()
    .match(
      /(\d{1,2})\.?\s+([a-zá-žěščřžýáíéůú]+)\s*(\d{4})?\s*(?:-|–|—|až|do|to)\s*(\d{1,2})\.?\s+([a-zá-žěščřžýáíéůú]+)\s*(\d{4})?/
    );
  if (words) {
    const m1 = MONTH_WORDS[words[2]!];
    const m2 = MONTH_WORDS[words[5]!];
    if (m1 && m2) {
      const y2 = words[6] ? Number(words[6]) : referenceYear;
      const y1 = words[3] ? Number(words[3]) : y2;
      return { from: `${y1}-${pad(m1)}-${pad(Number(words[1]))}`, to: `${y2}-${pad(m2)}-${pad(Number(words[4]))}` };
    }
  }
  return null;
}

/** Počet osob z volného textu. */
export function extractGuestCount(text: string): number | null {
  const m = text.match(
    /(\d{1,2})\s*(osob\w*|lid[íi]|dosp[ěe]l\w*|guests?|people|persons?|pax|osób|osoby|человек|гостей|адам)/i
  );
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) return n;
  }
  return null;
}

/** Telefonní číslo z volného textu. */
export function extractPhone(text: string): string | null {
  const m = text.match(/(\+?\d[\d\s().-]{7,17}\d)/);
  if (!m) return null;
  const digits = m[1]!.replace(/[^\d+]/g, '');
  return digits.length >= 9 ? m[1]!.trim() : null;
}

/** Čas příjezdu ("ve 14:00", "around 3 pm"). */
export function extractArrivalTime(text: string): string | null {
  const m24 = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (m24) return `${pad(Number(m24[1]))}:${m24[2]}`;
  const m12 = text.match(/\b(1[0-2]|[1-9])\s*(am|pm)\b/i);
  if (m12) {
    let h = Number(m12[1]);
    if (/pm/i.test(m12[2]!) && h < 12) h += 12;
    if (/am/i.test(m12[2]!) && h === 12) h = 0;
    return `${pad(h)}:00`;
  }
  return null;
}
