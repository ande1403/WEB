import type { Env, OutboundEmail } from './types';
import * as gmail from './google/gmail';
import * as cal from './google/calendar';
import { logOutbox } from './storage/db';

/**
 * Jediné místo, kudy jdou VŠECHNY zápisy ven (e-mail, kalendář).
 * Když je DRY_RUN=1, nic se neodešle ani nezapíše — akce se jen zaloguje do tabulky outbox
 * a vrátí se falešné ID, aby navazující logika doběhla celá a šla zkontrolovat.
 *
 * Čtení (Gmail search, výpis kalendáře) tímhle NEPROCHÁZÍ — číst je bezpečné vždy.
 */

export function isDryRun(env: Env): boolean {
  return String(env.DRY_RUN ?? '1') === '1';
}

function fakeId(prefix: string): string {
  return `${prefix}-dryrun-${crypto.randomUUID().slice(0, 8)}`;
}

export async function sendMail(
  env: Env,
  mail: OutboundEmail,
  ref?: string
): Promise<{ id: string; threadId: string }> {
  if (isDryRun(env)) {
    const id = fakeId('msg');
    await logOutbox(env, {
      dry_run: true,
      channel: 'gmail',
      action: 'send',
      ref: ref ?? null,
      payload: mail,
      result: 'DRY_RUN — neodesláno',
    });
    return { id, threadId: mail.threadId ?? fakeId('thr') };
  }
  try {
    const res = await gmail.sendEmail(env, mail);
    await logOutbox(env, {
      dry_run: false,
      channel: 'gmail',
      action: 'send',
      ref: ref ?? null,
      payload: mail,
      result: `sent:${res.id}`,
    });
    return res;
  } catch (err) {
    await logOutbox(env, {
      dry_run: false,
      channel: 'gmail',
      action: 'send',
      ref: ref ?? null,
      payload: mail,
      result: `ERROR: ${(err as Error).message}`,
    });
    throw err;
  }
}

export async function createEvent(env: Env, ev: cal.NewEvent, ref?: string): Promise<string> {
  if (isDryRun(env)) {
    const id = fakeId('evt');
    await logOutbox(env, {
      dry_run: true,
      channel: 'calendar',
      action: 'create',
      ref: ref ?? null,
      payload: ev,
      result: `DRY_RUN — nezaloženo (${id})`,
    });
    return id;
  }
  try {
    const res = await cal.createEvent(env, ev);
    await logOutbox(env, {
      dry_run: false,
      channel: 'calendar',
      action: 'create',
      ref: ref ?? null,
      payload: ev,
      result: `created:${res.id}`,
    });
    return res.id;
  } catch (err) {
    await logOutbox(env, {
      dry_run: false,
      channel: 'calendar',
      action: 'create',
      ref: ref ?? null,
      payload: ev,
      result: `ERROR: ${(err as Error).message}`,
    });
    throw err;
  }
}

export async function patchEvent(
  env: Env,
  eventId: string,
  patch: Partial<cal.NewEvent>,
  ref?: string
): Promise<void> {
  if (isDryRun(env)) {
    await logOutbox(env, {
      dry_run: true,
      channel: 'calendar',
      action: 'patch',
      ref: ref ?? eventId,
      payload: { eventId, patch },
      result: 'DRY_RUN — nezměněno',
    });
    return;
  }
  await cal.patchEvent(env, eventId, patch);
  await logOutbox(env, {
    dry_run: false,
    channel: 'calendar',
    action: 'patch',
    ref: ref ?? eventId,
    payload: { eventId, patch },
    result: 'patched',
  });
}

export async function deleteEvent(env: Env, eventId: string, ref?: string): Promise<void> {
  if (isDryRun(env)) {
    await logOutbox(env, {
      dry_run: true,
      channel: 'calendar',
      action: 'delete',
      ref: ref ?? eventId,
      payload: { eventId },
      result: 'DRY_RUN — nesmazáno',
    });
    return;
  }
  await cal.deleteEvent(env, eventId);
  await logOutbox(env, {
    dry_run: false,
    channel: 'calendar',
    action: 'delete',
    ref: ref ?? eventId,
    payload: { eventId },
    result: 'deleted',
  });
}
