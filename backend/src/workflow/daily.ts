import type { Env, Lang, Reservation } from '../types';
import { deleteEvent, sendMail } from '../gateway';
import * as tpl from './templates';
import { ensureCleaningBlock, notifyOwner } from './inbound';
import { updateReservation } from '../storage/db';
import { addDays, formatDate, nextPossibleCheckin } from '../util/dates';
import { cleaningRecipients } from '../util/config';

/**
 * Časové úlohy. Všechny podmínky jsou psané jako "ještě neodesláno A už nastal den X",
 * ne "přesně den X" — když cron vynechá běh (výpadek, nasazení), další běh to dožene
 * místo aby událost tiše propadla.
 */

async function query(env: Env, sql: string, ...bind: unknown[]): Promise<Reservation[]> {
  const res = await env.DB.prepare(sql).bind(...bind).all<Reservation>();
  return res.results ?? [];
}

export async function runDailyJobs(env: Env, today: string): Promise<string[]> {
  const actions: string[] = [];
  actions.push(...(await sendFollowUps(env, today)));
  actions.push(...(await expireHolds(env, today)));
  actions.push(...(await backfillCleaningBlocks(env, today)));
  actions.push(...(await sendDepartureEmails(env, today)));
  actions.push(...(await sendCleaningNotices(env, today)));
  actions.push(...(await remindPendingApprovals(env, today)));
  return actions;
}

/* ------------------------------------------- dohledávka 2 dny před vypršením holdu */

async function sendFollowUps(env: Env, today: string): Promise<string[]> {
  const before = Number(env.FOLLOWUP_BEFORE_EXPIRY_DAYS || '2');
  const rows = await query(
    env,
    `SELECT * FROM reservations
      WHERE status = 'provisional'
        AND followup_sent_at IS NULL
        AND hold_expires_at IS NOT NULL
        AND date(hold_expires_at, '-${before} day') <= ?
        AND hold_expires_at >= ?`,
    today,
    today
  );

  const out: string[] = [];
  for (const r of rows) {
    const mail = tpl.followUp(r.lang as Lang, {
      name: r.guest_name,
      checkin: r.checkin,
      checkout: r.checkout,
      guests: r.guests_count,
      holdExpiry: r.hold_expires_at ?? undefined,
    });
    await sendMail(
      env,
      { to: r.guest_email, subject: mail.subject, body: mail.body, threadId: r.thread_id },
      `res:${r.id}:followup`
    );
    await updateReservation(env, r.id, { followup_sent_at: today });
    out.push(`dohledávka odeslána hostovi #${r.id} (${r.guest_email})`);
  }
  return out;
}

/* --------------------------------------------------- vypršení provizorního držení */

async function expireHolds(env: Env, today: string): Promise<string[]> {
  const rows = await query(
    env,
    `SELECT * FROM reservations
      WHERE status = 'provisional' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?`,
    today
  );

  const out: string[] = [];
  for (const r of rows) {
    if (r.calendar_event_id) {
      try {
        await deleteEvent(env, r.calendar_event_id, `res:${r.id}`);
      } catch (err) {
        await notifyOwner(
          env,
          `nepodařilo se smazat provizorní událost #${r.id}`,
          `Rezervace #${r.id} (${r.guest_email}) vypršela, ale událost v kalendáři se nepodařilo smazat:\n${
            (err as Error).message
          }\nSmaž ji prosím ručně.`,
          `res:${r.id}`
        );
      }
    }
    await updateReservation(env, r.id, { status: 'expired', calendar_event_id: null });
    await notifyOwner(
      env,
      `provizorní držení vypršelo – ${r.guest_email}`,
      `Host ${r.guest_name ?? r.guest_email} nedoplnil údaje do ${r.hold_expires_at}.\nTermín ${formatDate(
        r.checkin,
        'cs'
      )} – ${formatDate(r.checkout, 'cs')} jsem uvolnil a událost z kalendáře odstranil.\nHostovi jsem nic neposílal.`,
      `res:${r.id}`
    );
    out.push(`hold vypršel a byl uvolněn: #${r.id}`);
  }
  return out;
}

/* ------------------------------- doplnění chybějících úklidových bloků u potvrzených */

async function backfillCleaningBlocks(env: Env, today: string): Promise<string[]> {
  const rows = await query(
    env,
    `SELECT * FROM reservations
      WHERE status = 'confirmed' AND cleaning_event_id IS NULL AND checkout >= ?`,
    addDays(today, -1)
  );
  const out: string[] = [];
  for (const r of rows) {
    await ensureCleaningBlock(env, r);
    out.push(`doplněn úklidový blok pro #${r.id}`);
  }
  return out;
}

/* --------------------------------------------- pokyny k odjezdu (den před odjezdem) */

async function sendDepartureEmails(env: Env, today: string): Promise<string[]> {
  const rows = await query(
    env,
    `SELECT * FROM reservations
      WHERE status = 'confirmed'
        AND departure_email_sent_at IS NULL
        AND date(checkout, '-1 day') <= ?
        AND checkout >= ?`,
    today,
    today
  );

  const out: string[] = [];
  for (const r of rows) {
    const mail = tpl.departure(r.lang as Lang, {
      name: r.guest_name,
      checkin: r.checkin,
      checkout: r.checkout,
    });
    await sendMail(
      env,
      { to: r.guest_email, subject: mail.subject, body: mail.body, threadId: r.thread_id },
      `res:${r.id}:departure`
    );
    await updateReservation(env, r.id, { departure_email_sent_at: today });
    out.push(`pokyny k odjezdu odeslány hostovi #${r.id}`);
  }
  return out;
}

/* ------------------------------------------- avízo na úklid (2 dny před odjezdem) */

async function sendCleaningNotices(env: Env, today: string): Promise<string[]> {
  const rows = await query(
    env,
    `SELECT * FROM reservations
      WHERE status = 'confirmed'
        AND cleaning_email_sent_at IS NULL
        AND date(checkout, '-2 day') <= ?
        AND checkout >= ?`,
    today,
    today
  );

  const out: string[] = [];
  const cleaningDays = Number(env.CLEANING_BLOCK_DAYS || '3');
  for (const r of rows) {
    const next = await nextConfirmedCheckin(env, r.checkout);
    const mail = tpl.cleaningNotice({
      guestName: r.guest_name ?? r.guest_email,
      name: r.guest_name,
      checkin: r.checkin,
      checkout: r.checkout,
      guests: r.guests_count,
      phone: r.guest_phone,
      nextCheckin: next,
    });
    const recipients = cleaningRecipients(env);
    await sendMail(
      env,
      {
        to: recipients[0]!,
        cc: recipients.slice(1).join(', ') || null,
        subject: mail.subject,
        body: `${mail.body}\n\n(Nejbližší možný příjezd dalšího hosta podle pravidla úklidu: ${nextPossibleCheckin(
          r.checkout,
          cleaningDays
        )}.)`,
      },
      `res:${r.id}:cleaning-notice`
    );
    await updateReservation(env, r.id, { cleaning_email_sent_at: today });
    out.push(`avízo na úklid odesláno (#${r.id})`);
  }
  return out;
}

async function nextConfirmedCheckin(env: Env, afterDate: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT checkin FROM reservations
      WHERE status IN ('confirmed','provisional') AND checkin > ?
      ORDER BY checkin LIMIT 1`
  )
    .bind(afterDate)
    .first<{ checkin: string }>();
  return row?.checkin ?? null;
}

/* ------------------------------------------- připomínka nevyřízených schvalování */

async function remindPendingApprovals(env: Env, today: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const res = await env.DB.prepare(
    `SELECT * FROM approvals WHERE status = 'pending' AND created_at < ? AND (result IS NULL OR result <> 'reminded')`
  )
    .bind(cutoff)
    .all<{ id: string; to_email: string; subject: string; created_at: string }>();

  const out: string[] = [];
  for (const a of res.results ?? []) {
    await notifyOwner(
      env,
      `čeká na schválení už od ${a.created_at.slice(0, 10)}`,
      `Návrh odpovědi pro ${a.to_email} („${a.subject}") pořád čeká na schválení.\nDokud ho neschválíš, host od nás nedostal nic a provizorní držení termínu mezitím běží.\nOriginální e-mail se schvalovacími odkazy máš ve schránce.`,
      `approval:${a.id}`
    );
    await env.DB.prepare('UPDATE approvals SET result = ? WHERE id = ?').bind('reminded', a.id).run();
    out.push(`připomenuto nevyřízené schválení ${a.id} (${today})`);
  }
  return out;
}
