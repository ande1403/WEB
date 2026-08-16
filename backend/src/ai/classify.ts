import type { Classification, Env, InboundMessage, Lang, Reservation } from '../types';
import { LANGS } from '../types';
import {
  extractArrivalTime,
  extractDateRange,
  extractGuestCount,
  extractPhone,
  guessLang,
  parseWeb3Forms,
  stripQuoted,
} from '../util/text';
import { isDate } from '../util/dates';

/**
 * Klasifikace příchozí zprávy.
 *
 * Dvě vrstvy:
 *   1. heuristika — parsuje Web3Forms pole a hledá datum/počet osob/telefon regulárními výrazy.
 *      Funguje bez AI a bez sítě, používá se jako fallback i jako doplnění chybějících polí.
 *   2. model (OpenAI) — rozumí volnému textu v 6 jazycích a rozliší vyjednávání od doplnění údajů.
 *
 * Výsledek modelu má přednost, heuristika doplní, co model nevrátil.
 */

const SYSTEM_PROMPT = `You are an assistant for a small apartment rental (ANDE 1403, Batumi, Georgia).
You classify incoming e-mails and extract structured booking data. You never invent facts.

Message kinds:
- "new_inquiry": someone asks about staying / requests dates for the first time (typically a website contact-form submission).
- "guest_details": an existing guest replies with the details we asked for (full name, phone, arrival time) or otherwise confirms.
- "negotiation": the guest wants to change something or asks about price, discount, extra beds, early check-in, different dates, or any condition that requires a human decision.
- "cancellation": the guest cancels or says they are no longer interested.
- "other": anything else (spam, invoices, newsletters, service notifications).

Rules:
- Dates: return ISO YYYY-MM-DD. "checkin" is the arrival day, "checkout" is the DEPARTURE day (the guest is still present that day). European "29.10.2026 - 3.11.2026" means checkin 2026-10-29, checkout 2026-11-03. If a year is missing, choose the nearest future occurrence relative to TODAY.
- "lang" is the language the guest writes in: one of cs, en, pl, ru, ka, he. Use the language of the guest's own text, not of the form template.
- "proposed_reply": ONLY fill this for kind "negotiation" — a short draft reply in the guest's language. Never state a price, a discount, an address, Wi-Fi details or any fact you were not given; if the guest asks for such a thing, write the placeholder [DOPLNIT] there. For all other kinds return null.
- Never guess a phone number or a name that is not in the text. Use null.
- "confidence" 0..1 = how sure you are about the kind and the extracted dates.
Return strict JSON only.`;

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'lang',
    'guest_name',
    'guest_email',
    'guest_phone',
    'guests_count',
    'checkin',
    'checkout',
    'arrival_time',
    'summary',
    'proposed_reply',
    'confidence',
  ],
  properties: {
    kind: { type: 'string', enum: ['new_inquiry', 'guest_details', 'negotiation', 'cancellation', 'other'] },
    lang: { type: 'string', enum: LANGS },
    guest_name: { type: ['string', 'null'] },
    guest_email: { type: ['string', 'null'] },
    guest_phone: { type: ['string', 'null'] },
    guests_count: { type: ['integer', 'null'] },
    checkin: { type: ['string', 'null'] },
    checkout: { type: ['string', 'null'] },
    arrival_time: { type: ['string', 'null'] },
    summary: { type: 'string' },
    proposed_reply: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
} as const;

export function heuristicClassify(
  msg: InboundMessage,
  today: string,
  existing?: Reservation | null
): Classification {
  const form = parseWeb3Forms(msg.body);
  const text = form?.message ?? stripQuoted(msg.body);
  const year = Number(today.slice(0, 4));
  const range = extractDateRange(text, year);
  const lang = guessLang(text || msg.subject);

  const isForm = !!form?.email;
  const kind: Classification['kind'] = isForm
    ? 'new_inquiry'
    : existing
      ? 'guest_details'
      : range
        ? 'new_inquiry'
        : 'other';

  return {
    kind,
    lang,
    guest_name: form?.name ?? msg.fromName ?? null,
    guest_email: form?.email ?? (msg.from || null),
    guest_phone: extractPhone(text),
    guests_count: extractGuestCount(text),
    checkin: range?.from ?? null,
    checkout: range?.to ?? null,
    arrival_time: extractArrivalTime(text),
    summary: text.slice(0, 200).replace(/\s+/g, ' '),
    proposed_reply: null,
    confidence: isForm && range ? 0.6 : 0.3,
    source: 'heuristic',
  };
}

export async function classifyMessage(
  env: Env,
  msg: InboundMessage,
  today: string,
  existing?: Reservation | null
): Promise<Classification> {
  const base = heuristicClassify(msg, today, existing);
  if (!env.OPENAI_API_KEY) return base;

  const form = parseWeb3Forms(msg.body);
  const cleanBody = form?.message ?? stripQuoted(msg.body);

  const context = [
    `TODAY: ${today}`,
    `SUBJECT: ${msg.subject}`,
    `FROM: ${msg.fromName ?? ''} <${msg.from}>`,
    form?.email ? `WEBSITE FORM — guest name: ${form.name ?? '?'}, guest e-mail: ${form.email}` : '',
    existing
      ? `EXISTING BOOKING for this guest: ${existing.checkin} – ${existing.checkout}, status ${existing.status}, name ${existing.guest_name ?? '?'}, phone ${existing.guest_phone ?? 'missing'}, arrival time ${existing.arrival_time ?? 'missing'}`
      : 'No existing booking found for this sender.',
    '',
    'MESSAGE:',
    cleanBody.slice(0, 6000),
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: context },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'classification', strict: true, schema: JSON_SCHEMA },
        },
      }),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]!.message.content) as Partial<Classification>;
    return mergeClassification(base, parsed);
  } catch (err) {
    console.error('AI klasifikace selhala, používám heuristiku:', (err as Error).message);
    return { ...base, summary: `${base.summary} [AI nedostupné: ${(err as Error).message.slice(0, 120)}]` };
  }
}

export function mergeClassification(base: Classification, ai: Partial<Classification>): Classification {
  const validDate = (d: unknown): string | null => (typeof d === 'string' && isDate(d) ? d : null);
  const lang: Lang = LANGS.includes(ai.lang as Lang) ? (ai.lang as Lang) : base.lang;
  return {
    kind: ai.kind ?? base.kind,
    lang,
    guest_name: ai.guest_name ?? base.guest_name,
    // e-mail hosta z formuláře je spolehlivější než cokoliv, co model vytáhne z textu
    guest_email: base.guest_email ?? ai.guest_email ?? null,
    guest_phone: ai.guest_phone ?? base.guest_phone,
    guests_count: ai.guests_count ?? base.guests_count,
    checkin: validDate(ai.checkin) ?? base.checkin,
    checkout: validDate(ai.checkout) ?? base.checkout,
    arrival_time: ai.arrival_time ?? base.arrival_time,
    summary: ai.summary ?? base.summary,
    proposed_reply: ai.kind === 'negotiation' ? (ai.proposed_reply ?? null) : null,
    confidence: typeof ai.confidence === 'number' ? ai.confidence : base.confidence,
    source: 'ai',
  };
}
