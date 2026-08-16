import type { Approval, ApprovalStatus, Env, Lang, Reservation, ReservationStatus } from '../types';

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ rezervace */

export interface NewReservation {
  guest_name?: string | null;
  guest_email: string;
  guest_phone?: string | null;
  guests_count?: number | null;
  lang: Lang;
  checkin: string;
  checkout: string;
  arrival_time?: string | null;
  status: ReservationStatus;
  hold_expires_at?: string | null;
  calendar_event_id?: string | null;
  source?: string | null;
  thread_id?: string | null;
  note?: string | null;
}

export async function insertReservation(env: Env, r: NewReservation): Promise<number> {
  const ts = nowIso();
  const res = await env.DB.prepare(
    `INSERT INTO reservations
       (guest_name, guest_email, guest_phone, guests_count, lang, checkin, checkout,
        arrival_time, status, hold_expires_at, calendar_event_id, source, thread_id, note,
        created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      r.guest_name ?? null,
      r.guest_email,
      r.guest_phone ?? null,
      r.guests_count ?? null,
      r.lang,
      r.checkin,
      r.checkout,
      r.arrival_time ?? null,
      r.status,
      r.hold_expires_at ?? null,
      r.calendar_event_id ?? null,
      r.source ?? null,
      r.thread_id ?? null,
      r.note ?? null,
      ts,
      ts
    )
    .run();
  const id = (res.meta as { last_row_id?: number } | undefined)?.last_row_id;
  if (typeof id !== 'number') throw new Error('INSERT reservations nevrátil last_row_id');
  return id;
}

const RES_FIELDS = new Set([
  'guest_name',
  'guest_email',
  'guest_phone',
  'guests_count',
  'lang',
  'checkin',
  'checkout',
  'arrival_time',
  'status',
  'hold_expires_at',
  'followup_sent_at',
  'calendar_event_id',
  'cleaning_event_id',
  'departure_email_sent_at',
  'cleaning_email_sent_at',
  'source',
  'thread_id',
  'note',
]);

export async function updateReservation(
  env: Env,
  id: number,
  patch: Partial<Reservation>
): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => RES_FIELDS.has(k));
  if (!entries.length) return;
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  await env.DB.prepare(`UPDATE reservations SET ${sets}, updated_at = ? WHERE id = ?`)
    .bind(...entries.map(([, v]) => v ?? null), nowIso(), id)
    .run();
}

export async function getReservation(env: Env, id: number): Promise<Reservation | null> {
  return env.DB.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first<Reservation>();
}

export async function activeReservations(env: Env): Promise<Reservation[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM reservations WHERE status IN ('provisional','confirmed') ORDER BY checkin`
  ).all<Reservation>();
  return res.results ?? [];
}

/** Poslední živá rezervace daného hosta (podle e-mailu), nejdřív provizorní. */
export async function findReservationByEmail(env: Env, email: string): Promise<Reservation | null> {
  return env.DB.prepare(
    `SELECT * FROM reservations
      WHERE lower(guest_email) = lower(?) AND status IN ('provisional','confirmed')
      ORDER BY CASE status WHEN 'provisional' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`
  )
    .bind(email)
    .first<Reservation>();
}

export async function findReservationByThread(env: Env, threadId: string): Promise<Reservation | null> {
  return env.DB.prepare(
    `SELECT * FROM reservations
      WHERE thread_id = ? AND status IN ('provisional','confirmed')
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(threadId)
    .first<Reservation>();
}

/* ------------------------------------------------- zpracované zprávy (idempotence) */

export async function wasProcessed(env: Env, messageId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS x FROM processed_messages WHERE message_id = ?')
    .bind(messageId)
    .first<{ x: number }>();
  return !!row;
}

export async function markProcessed(
  env: Env,
  m: {
    message_id: string;
    thread_id?: string | null;
    from_email?: string | null;
    subject?: string | null;
    internal_date?: string | null;
    kind?: string | null;
    reservation_id?: number | null;
    summary?: string | null;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO processed_messages
      (message_id, thread_id, from_email, subject, internal_date, processed_at, kind, reservation_id, summary)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      m.message_id,
      m.thread_id ?? null,
      m.from_email ?? null,
      m.subject ?? null,
      m.internal_date ?? null,
      nowIso(),
      m.kind ?? null,
      m.reservation_id ?? null,
      m.summary ?? null
    )
    .run();
}

/* ---------------------------------------------------------------- schvalování */

export interface NewApproval {
  id: string;
  kind: Approval['kind'];
  reservation_id?: number | null;
  to_email: string;
  subject: string;
  body: string;
  lang?: Lang | null;
  thread_id?: string | null;
  in_reply_to?: string | null;
  context?: unknown;
}

export async function insertApproval(env: Env, a: NewApproval): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO approvals
      (id, created_at, status, kind, reservation_id, to_email, subject, body, lang, thread_id, in_reply_to, context)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      a.id,
      nowIso(),
      'pending',
      a.kind,
      a.reservation_id ?? null,
      a.to_email,
      a.subject,
      a.body,
      a.lang ?? null,
      a.thread_id ?? null,
      a.in_reply_to ?? null,
      a.context ? JSON.stringify(a.context) : null
    )
    .run();
}

export async function getApproval(env: Env, id: string): Promise<Approval | null> {
  return env.DB.prepare('SELECT * FROM approvals WHERE id = ?').bind(id).first<Approval>();
}

export async function setApprovalStatus(
  env: Env,
  id: string,
  status: ApprovalStatus,
  result?: string
): Promise<void> {
  await env.DB.prepare('UPDATE approvals SET status = ?, decided_at = ?, result = ? WHERE id = ?')
    .bind(status, nowIso(), result ?? null, id)
    .run();
}

export async function pendingApprovals(env: Env): Promise<Approval[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at`
  ).all<Approval>();
  return res.results ?? [];
}

/* --------------------------------------------------------------------- outbox */

export async function logOutbox(
  env: Env,
  entry: { dry_run: boolean; channel: string; action: string; ref?: string | null; payload: unknown; result?: string | null }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO outbox (created_at, dry_run, channel, action, ref, payload, result)
     VALUES (?,?,?,?,?,?,?)`
  )
    .bind(
      nowIso(),
      entry.dry_run ? 1 : 0,
      entry.channel,
      entry.action,
      entry.ref ?? null,
      JSON.stringify(entry.payload),
      entry.result ?? null
    )
    .run();
}

export async function recentOutbox(env: Env, limit = 50): Promise<Record<string, unknown>[]> {
  const res = await env.DB.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT ?').bind(limit).all();
  return (res.results ?? []) as Record<string, unknown>[];
}

/* -------------------------------------------------------------------- job log */

export async function startJob(env: Env, trigger: string): Promise<number> {
  const res = await env.DB.prepare('INSERT INTO job_log (started_at, trigger) VALUES (?,?)')
    .bind(nowIso(), trigger)
    .run();
  return (res.meta as { last_row_id?: number }).last_row_id ?? 0;
}

export async function finishJob(
  env: Env,
  id: number,
  data: { ok: boolean; messages_seen?: number; actions?: string[]; error?: string }
): Promise<void> {
  await env.DB.prepare(
    'UPDATE job_log SET finished_at = ?, ok = ?, messages_seen = ?, actions = ?, error = ? WHERE id = ?'
  )
    .bind(
      nowIso(),
      data.ok ? 1 : 0,
      data.messages_seen ?? 0,
      JSON.stringify(data.actions ?? []),
      data.error ?? null,
      id
    )
    .run();
}

export async function recentJobs(env: Env, limit = 20): Promise<Record<string, unknown>[]> {
  const res = await env.DB.prepare('SELECT * FROM job_log ORDER BY id DESC LIMIT ?').bind(limit).all();
  return (res.results ?? []) as Record<string, unknown>[];
}
