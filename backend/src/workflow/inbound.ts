import type { Classification, Env, InboundMessage, Lang, Reservation } from '../types';
import { classifyMessage } from '../ai/classify';
import { checkAvailability } from './availability';
import { queueForApproval, datesLabel } from './approvals';
import * as tpl from './templates';
import { createEvent, patchEvent, sendMail } from '../gateway';
import { CLEANING_COLOR_ID } from '../google/calendar';
import {
  findReservationByEmail,
  findReservationByThread,
  insertReservation,
  markProcessed,
  updateReservation,
  wasProcessed,
} from '../storage/db';
import { addDays, cleaningBlock, formatDate, toExclusiveEnd } from '../util/dates';
import { parseWeb3Forms, stripQuoted } from '../util/text';

export interface ProcessResult {
  messageId: string;
  kind: string;
  action: string;
  reservationId?: number;
}

/** Interní notifikace Jakubovi (ne hostovi) — nepodléhá schvalování. */
export async function notifyOwner(env: Env, subject: string, body: string, ref?: string): Promise<void> {
  await sendMail(env, { to: env.OWNER_EMAIL, subject: `[ANDE] ${subject}`, body }, ref);
}

function eventDescription(r: {
  guest_email: string;
  guests_count?: number | null;
  lang: string;
  guest_phone?: string | null;
  arrival_time?: string | null;
  hold_expires_at?: string | null;
  id?: number;
  source?: string | null;
}): string {
  return [
    `E-mail hosta: ${r.guest_email}`,
    `Počet osob: ${r.guests_count ?? '?'}`,
    `Jazyk komunikace: ${r.lang}`,
    `Telefon: ${r.guest_phone ?? '—'}`,
    `Předpokládaný příjezd: ${r.arrival_time ?? '—'}`,
    r.hold_expires_at ? `Provizorní držení platí do: ${r.hold_expires_at}` : '',
    r.id ? `ID rezervace: ${r.id}` : '',
    `Zdroj: ${r.source ?? 'e-mail'}`,
    '',
    'Spravováno automaticky Workerem ande1403-backend.',
  ]
    .filter(Boolean)
    .join('\n');
}

function provisionalTitle(name: string | null, guests: number | null): string {
  return `PROVIZORNÍ – ${name ?? 'neznámý host'}${guests ? ` (${guests} osoby)` : ''}, čeká na doplnění údajů`;
}

function confirmedTitle(name: string | null, guests: number | null): string {
  return `${name ?? 'host'}${guests ? ` (${guests} osob)` : ''}`;
}

/** Zpracuje jednu příchozí zprávu. Idempotentní — už zpracovanou zprávu přeskočí. */
export async function processMessage(env: Env, msg: InboundMessage, today: string): Promise<ProcessResult | null> {
  if (await wasProcessed(env, msg.id)) return null;

  const mailbox = env.MAILBOX_EMAIL.toLowerCase();
  if (msg.from === mailbox || msg.labelIds.includes('SENT') || msg.labelIds.includes('DRAFT')) {
    await markProcessed(env, { message_id: msg.id, thread_id: msg.threadId, kind: 'own', summary: 'vlastní zpráva' });
    return null;
  }

  const form = parseWeb3Forms(msg.body);
  const guestEmail = (form?.email ?? msg.from ?? '').toLowerCase();

  let existing: Reservation | null = await findReservationByThread(env, msg.threadId);
  if (!existing && guestEmail) existing = await findReservationByEmail(env, guestEmail);

  const c = await classifyMessage(env, msg, today, existing);
  if (guestEmail) c.guest_email = guestEmail;

  const finish = async (action: string, reservationId?: number): Promise<ProcessResult> => {
    await markProcessed(env, {
      message_id: msg.id,
      thread_id: msg.threadId,
      from_email: guestEmail || msg.from,
      subject: msg.subject,
      internal_date: msg.date,
      kind: c.kind,
      reservation_id: reservationId ?? existing?.id ?? null,
      summary: `${action} | ${c.summary}`.slice(0, 500),
    });
    return { messageId: msg.id, kind: c.kind, action, reservationId };
  };

  switch (c.kind) {
    case 'new_inquiry':
      return finish(...(await handleNewInquiry(env, msg, c, today, existing)));
    case 'guest_details':
      return finish(...(await handleGuestDetails(env, msg, c, existing)));
    case 'negotiation':
      return finish(...(await handleNegotiation(env, msg, c, existing)));
    case 'cancellation':
      return finish(...(await handleCancellation(env, msg, c, existing)));
    default:
      return finish('ignorováno (other)');
  }
}

type Handled = [action: string, reservationId?: number];

async function handleNewInquiry(
  env: Env,
  msg: InboundMessage,
  c: Classification,
  today: string,
  existing: Reservation | null
): Promise<Handled> {
  const original = form2text(msg);

  if (existing && existing.checkin === c.checkin && existing.checkout === c.checkout) {
    await notifyOwner(
      env,
      `duplicitní poptávka – ${c.guest_email}`,
      `Přišla další zpráva ke stejnému termínu, který už je v systému jako rezervace #${existing.id}.\nNic jsem nezakládal.\n\n${original}`,
      `msg:${msg.id}`
    );
    return ['duplicitní poptávka – jen upozornění', existing.id];
  }

  if (!c.checkin || !c.checkout) {
    await notifyOwner(
      env,
      `poptávka bez jasného termínu – ${c.guest_email}`,
      `Z téhle zprávy jsem nedokázal spolehlivě vyčíst termín pobytu, takže jsem nic nedržel ani neodpovídal.\n\nOd: ${c.guest_name ?? ''} <${c.guest_email}>\nJazyk: ${c.lang}\n\n${original}`,
      `msg:${msg.id}`
    );
    return ['poptávka bez termínu – předáno člověku'];
  }

  if (c.checkout < c.checkin) {
    await notifyOwner(
      env,
      `poptávka s nesmyslným termínem – ${c.guest_email}`,
      `Vyčtený termín: ${c.checkin} – ${c.checkout} (konec před začátkem). Nic jsem nedělal.\n\n${original}`,
      `msg:${msg.id}`
    );
    return ['neplatný termín – předáno člověku'];
  }

  const avail = await checkAvailability(env, c.checkin, c.checkout);
  if (!avail.available) {
    await notifyOwner(
      env,
      `obsazený termín – ${c.guest_email} (${c.checkin} – ${c.checkout})`,
      `Host poptává obsazený termín, takže jsem nic nedržel ani neodpovídal — nabídnout náhradní termín je obchodní rozhodnutí.\n\nKolize:\n${avail.conflicts
        .map((k) => `• ${k.label}: ${k.start} – ${k.end} (${k.source})`)
        .join('\n')}\n\nNejbližší volný začátek podle pravidla úklidu: ${avail.suggestion ?? '?'}\n\n${original}`,
      `msg:${msg.id}`
    );
    return ['termín obsazený – předáno člověku'];
  }

  const holdExpiry = addDays(today, Number(env.HOLD_DAYS || '5'));

  const reservationId = await insertReservation(env, {
    guest_name: c.guest_name,
    guest_email: c.guest_email ?? msg.from,
    guest_phone: c.guest_phone,
    guests_count: c.guests_count,
    lang: c.lang,
    checkin: c.checkin,
    checkout: c.checkout,
    arrival_time: c.arrival_time,
    status: 'provisional',
    hold_expires_at: holdExpiry,
    source: parseWeb3Forms(msg.body) ? 'web-form' : 'email',
    thread_id: msg.threadId,
    note: c.summary.slice(0, 300),
  });

  const eventId = await createEvent(
    env,
    {
      summary: provisionalTitle(c.guest_name, c.guests_count),
      description: eventDescription({
        guest_email: c.guest_email ?? msg.from,
        guests_count: c.guests_count,
        lang: c.lang,
        guest_phone: c.guest_phone,
        arrival_time: c.arrival_time,
        hold_expires_at: holdExpiry,
        id: reservationId,
        source: 'web formulář',
      }),
      start: c.checkin,
      endExclusive: toExclusiveEnd(c.checkout),
    },
    `res:${reservationId}`
  );
  await updateReservation(env, reservationId, { calendar_event_id: eventId });

  const draft = tpl.firstReply(c.lang, {
    name: c.guest_name,
    checkin: c.checkin,
    checkout: c.checkout,
    guests: c.guests_count,
    holdExpiry,
  });

  await queueForApproval(env, {
    kind: 'first_reply',
    reservationId,
    guestEmail: c.guest_email ?? msg.from,
    guestName: c.guest_name,
    lang: c.lang,
    subject: draft.subject,
    body: draft.body,
    threadId: msg.threadId,
    inReplyTo: msg.messageIdHeader,
    dates: datesLabel(c),
    summary: c.summary,
    originalMessage: original,
  });

  return [`provizorní hold založen, odpověď čeká na schválení`, reservationId];
}

async function handleGuestDetails(
  env: Env,
  msg: InboundMessage,
  c: Classification,
  existing: Reservation | null
): Promise<Handled> {
  const original = form2text(msg);

  if (!existing) {
    await notifyOwner(
      env,
      `odpověď hosta bez rezervace – ${c.guest_email}`,
      `Přišla zpráva, která vypadá jako doplnění údajů, ale k tomuhle e-mailu ani vláknu nemám žádnou živou rezervaci.\n\n${original}`,
      `msg:${msg.id}`
    );
    return ['doplnění bez rezervace – předáno člověku'];
  }

  const patch: Partial<Reservation> = {};
  if (c.guest_name && c.guest_name.length > (existing.guest_name?.length ?? 0)) patch.guest_name = c.guest_name;
  if (c.guest_phone) patch.guest_phone = c.guest_phone;
  if (c.arrival_time) patch.arrival_time = c.arrival_time;
  if (c.guests_count) patch.guests_count = c.guests_count;
  if (Object.keys(patch).length) await updateReservation(env, existing.id, patch);

  const merged: Reservation = { ...existing, ...patch };

  if (!merged.guest_name || !merged.guest_phone) {
    await notifyOwner(
      env,
      `neúplné doplnění údajů – rezervace #${existing.id}`,
      `Host odpověděl, ale pořád chybí: ${[!merged.guest_name ? 'jméno' : '', !merged.guest_phone ? 'telefon' : '']
        .filter(Boolean)
        .join(', ')}.\nRezervaci jsem nechal jako ${merged.status}. Odpověď hostovi jsem neposílal.\n\n${original}`,
      `msg:${msg.id}`
    );
    return ['neúplné údaje – předáno člověku', existing.id];
  }

  // 1) kalendář: z provizorní událost udělat potvrzenou
  if (merged.calendar_event_id) {
    await patchEvent(
      env,
      merged.calendar_event_id,
      {
        summary: confirmedTitle(merged.guest_name, merged.guests_count),
        description: eventDescription({
          guest_email: merged.guest_email,
          guests_count: merged.guests_count,
          lang: merged.lang,
          guest_phone: merged.guest_phone,
          arrival_time: merged.arrival_time,
          id: merged.id,
          source: merged.source,
        }),
      },
      `res:${merged.id}`
    );
  }

  // 2) úklidový blok
  const cleaningEventId = await ensureCleaningBlock(env, merged);

  // 3) potvrzovací e-mail — automaticky, bez schvalování
  const mail = tpl.confirmation(merged.lang as Lang, {
    name: merged.guest_name,
    checkin: merged.checkin,
    checkout: merged.checkout,
    guests: merged.guests_count,
  });
  await sendMail(
    env,
    {
      to: merged.guest_email,
      subject: mail.subject,
      body: mail.body,
      threadId: msg.threadId,
      inReplyTo: msg.messageIdHeader,
    },
    `res:${merged.id}`
  );

  await updateReservation(env, merged.id, {
    status: 'confirmed',
    hold_expires_at: null,
    cleaning_event_id: cleaningEventId,
  });

  return ['rezervace potvrzena (kalendář + úklid + potvrzovací e-mail)', merged.id];
}

/** Založí úklidový blok, pokud ještě není. Vrací id události. */
export async function ensureCleaningBlock(env: Env, r: Reservation): Promise<string> {
  if (r.cleaning_event_id) return r.cleaning_event_id;
  const days = Number(env.CLEANING_BLOCK_DAYS || '3');
  const block = cleaningBlock(r.checkout, days);
  const id = await createEvent(
    env,
    {
      summary: `ÚKLID – po ${r.guest_name ?? r.guest_email}`,
      description: `Blok na úklid po pobytu ${r.checkin} – ${r.checkout}.\nDalší host může přijet nejdřív ${addDays(
        r.checkout,
        days
      )}.\nRezervace #${r.id}.`,
      start: block.start,
      endExclusive: block.endExclusive,
      colorId: CLEANING_COLOR_ID,
    },
    `res:${r.id}:cleaning`
  );
  await updateReservation(env, r.id, { cleaning_event_id: id });
  return id;
}

async function handleNegotiation(
  env: Env,
  msg: InboundMessage,
  c: Classification,
  existing: Reservation | null
): Promise<Handled> {
  const original = form2text(msg);
  const lang = (existing?.lang as Lang) ?? c.lang;
  const subject = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`;
  const body =
    c.proposed_reply ??
    `[Návrh se nepodařilo vygenerovat — napiš odpověď ručně.]\n\nShrnutí požadavku hosta: ${c.summary}`;

  await queueForApproval(env, {
    kind: 'negotiation',
    reservationId: existing?.id ?? null,
    guestEmail: c.guest_email ?? msg.from,
    guestName: c.guest_name ?? existing?.guest_name ?? null,
    lang,
    subject,
    body,
    threadId: msg.threadId,
    inReplyTo: msg.messageIdHeader,
    dates: existing ? `${formatDate(existing.checkin, 'cs')} – ${formatDate(existing.checkout, 'cs')}` : datesLabel(c),
    summary: c.summary,
    originalMessage: original,
  });

  return ['vyjednávání – návrh čeká na schválení', existing?.id];
}

async function handleCancellation(
  env: Env,
  msg: InboundMessage,
  c: Classification,
  existing: Reservation | null
): Promise<Handled> {
  // Zrušení nikdy neprovádím sám — falešný poplach by smazal platnou rezervaci.
  await notifyOwner(
    env,
    `host možná ruší – ${c.guest_email}${existing ? ` (rezervace #${existing.id})` : ''}`,
    `Zpráva vypadá jako zrušení pobytu. Nic jsem nezrušil ani neodpovídal — rozhodni ručně.\n${
      existing ? `\nRezervace #${existing.id}: ${existing.checkin} – ${existing.checkout}, stav ${existing.status}\n` : ''
    }\n${form2text(msg)}`,
    `msg:${msg.id}`
  );
  return ['možné zrušení – předáno člověku', existing?.id];
}

function form2text(msg: InboundMessage): string {
  const form = parseWeb3Forms(msg.body);
  if (form) {
    return `Jméno: ${form.name ?? '?'}\nE-mail: ${form.email ?? '?'}\nZpráva: ${form.message ?? ''}`;
  }
  return stripQuoted(msg.body).slice(0, 2000);
}
