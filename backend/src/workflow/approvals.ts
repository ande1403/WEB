import type { Approval, Classification, Env, InboundMessage, Lang } from '../types';
import { insertApproval, setApprovalStatus, getApproval, updateReservation } from '../storage/db';
import { sign, uuid } from '../util/crypto';
import { sendMail, isDryRun } from '../gateway';
import { approvalRequest } from './templates';
import { formatDate } from '../util/dates';

/**
 * Fronta schvalování. Pevné pravidlo projektu: první odpověď na novou poptávku a jakákoliv
 * vyjednávací odpověď NIKDY neodejdou samy — vždy je nejdřív schválí člověk.
 */

export async function approvalUrls(env: Env, id: string): Promise<{ approve: string; reject: string }> {
  const base = env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const [a, r] = await Promise.all([
    sign(env.APPROVAL_SECRET, `${id}:approve`),
    sign(env.APPROVAL_SECRET, `${id}:reject`),
  ]);
  return {
    approve: `${base}/approve/${id}?sig=${a}`,
    reject: `${base}/reject/${id}?sig=${r}`,
  };
}

export interface QueueArgs {
  kind: Approval['kind'];
  reservationId: number | null;
  guestEmail: string;
  guestName: string | null;
  lang: Lang;
  subject: string;
  body: string;
  threadId: string | null;
  inReplyTo: string | null;
  dates: string;
  summary: string;
  originalMessage: string;
}

/** Založí položku ke schválení a pošle Jakubovi e-mail s odkazy. */
export async function queueForApproval(env: Env, args: QueueArgs): Promise<string> {
  const id = uuid();
  await insertApproval(env, {
    id,
    kind: args.kind,
    reservation_id: args.reservationId,
    to_email: args.guestEmail,
    subject: args.subject,
    body: args.body,
    lang: args.lang,
    thread_id: args.threadId,
    in_reply_to: args.inReplyTo,
    context: { summary: args.summary, original: args.originalMessage.slice(0, 4000), dates: args.dates },
  });

  const urls = await approvalUrls(env, id);
  const mail = approvalRequest({
    kind: args.kind,
    guestEmail: args.guestEmail,
    guestName: args.guestName,
    lang: args.lang,
    dates: args.dates,
    summary: args.summary,
    original: args.originalMessage,
    proposed: { subject: args.subject, body: args.body },
    approveUrl: urls.approve,
    rejectUrl: urls.reject,
    dryRun: isDryRun(env),
  });

  // Žádost o schválení jde vždy jen Jakubovi — proto se posílá i v DRY_RUN? Ne:
  // v DRY_RUN se neodesílá nic, aby se dal celý běh vyhodnotit z tabulky outbox.
  await sendMail(env, { to: env.OWNER_EMAIL, subject: mail.subject, body: mail.body }, `approval:${id}`);
  return id;
}

/** Provede schválenou položku — teprve tady odchází e-mail hostovi. */
export async function executeApproval(env: Env, approval: Approval): Promise<string> {
  if (approval.status !== 'pending') {
    return `Položka už byla vyřízena (${approval.status}).`;
  }
  try {
    const res = await sendMail(
      env,
      {
        to: approval.to_email,
        subject: approval.subject,
        body: approval.body,
        threadId: approval.thread_id,
        inReplyTo: approval.in_reply_to,
      },
      `approval:${approval.id}`
    );
    await setApprovalStatus(env, approval.id, 'sent', `gmail:${res.id}`);
    if (approval.reservation_id) {
      await updateReservation(env, approval.reservation_id, {
        note: `první odpověď odeslána ${new Date().toISOString().slice(0, 10)}`,
      });
    }
    return isDryRun(env)
      ? 'Schváleno. Systém běží v DRY_RUN, e-mail se reálně neodeslal — je zalogovaný v tabulce outbox.'
      : 'Schváleno a odesláno hostovi.';
  } catch (err) {
    await setApprovalStatus(env, approval.id, 'failed', (err as Error).message);
    throw err;
  }
}

export async function rejectApproval(env: Env, approval: Approval): Promise<string> {
  if (approval.status !== 'pending') return `Položka už byla vyřízena (${approval.status}).`;
  await setApprovalStatus(env, approval.id, 'rejected', 'zamítnuto ručně');
  return 'Zamítnuto — hostovi nic neodešlo. Rezervace zůstává v systému, vyřiď ji ručně.';
}

/** Pomocná: hezký zápis termínu do předmětu/žádosti. */
export function datesLabel(c: Pick<Classification, 'checkin' | 'checkout'>, lang: Lang = 'cs'): string {
  if (!c.checkin || !c.checkout) return '(termín neurčen)';
  return `${formatDate(c.checkin, lang)} – ${formatDate(c.checkout, lang)}`;
}

export async function loadApproval(env: Env, id: string): Promise<Approval | null> {
  return getApproval(env, id);
}

export type { InboundMessage };
