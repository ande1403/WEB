import { beforeEach, describe, expect, it } from 'vitest';
import worker, { runCycle } from '../src/index';
import { runDailyJobs } from '../src/workflow/daily';
import { _resetTokenCache } from '../src/google/auth';
import { FakeGoogle } from './helpers/fakeGoogle';
import { GUEST_REPLY_BODY, WEB3FORMS_BODY, makeEnv } from './helpers/env';
import { sign } from '../src/util/crypto';
import { assertConfig, cleaningRecipients } from '../src/util/config';
import type { Classification, Env } from '../src/types';

/**
 * End-to-end: fingovaná poptávka projde celým tokem.
 * Žádná síť — Gmail, Calendar i OpenAI jsou nahrazené v paměti (viz helpers/fakeGoogle).
 */

const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const INQUIRY = {
  id: 'msg-inquiry',
  threadId: 'thread-1',
  from: 'ANDE 1403 · web <notify+bld7oj@web3forms.com>',
  subject: 'Rezervace pobytu – ANDE 1403',
  body: WEB3FORMS_BODY,
  multipart: true,
  messageIdHeader: '<inquiry@web3forms>',
};

const REPLY = {
  id: 'msg-reply',
  threadId: 'thread-1',
  from: '"Ing. Jan Novák" <host@example.com>',
  subject: 'Re: Rezervace pobytu – ANDE 1403',
  body: GUEST_REPLY_BODY,
  messageIdHeader: '<reply@seznam>',
};

const AI_INQUIRY: Partial<Classification> = {
  kind: 'new_inquiry',
  lang: 'cs',
  guest_name: 'Jan',
  guest_email: 'host@example.com',
  guest_phone: null,
  guests_count: 3,
  checkin: '2026-10-29',
  checkout: '2026-11-03',
  arrival_time: null,
  summary: 'Nová poptávka na 29.10.–3.11.2026 pro 3 osoby.',
  proposed_reply: null,
  confidence: 0.95,
};

const AI_DETAILS: Partial<Classification> = {
  kind: 'guest_details',
  lang: 'cs',
  guest_name: 'Jan Novák',
  guest_email: 'host@example.com',
  guest_phone: '777123456',
  guests_count: 3,
  checkin: '2026-10-29',
  checkout: '2026-11-03',
  arrival_time: '14:00',
  summary: 'Host doplnil jméno, telefon a čas příjezdu.',
  proposed_reply: null,
  confidence: 0.95,
};

let g: FakeGoogle;
let env: Env;

function res(db: unknown) {
  return (db as { dump: (t: string) => Record<string, unknown>[] }).dump('reservations');
}

beforeEach(() => {
  _resetTokenCache();
  g = new FakeGoogle();
  g.install();
  env = makeEnv({ OPENAI_API_KEY: 'test-key' });
});

describe('celý tok poptávky', () => {
  it('poptávka → provizorní hold + návrh ke schválení (hostovi zatím nic)', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;

    const out = await runCycle(env, 'test');
    expect(out.actions.join(' ')).toContain('provizorní hold založen');

    // 1. rezervace v DB
    const rows = res(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('provisional');
    expect(rows[0]!.checkin).toBe('2026-10-29');
    expect(rows[0]!.checkout).toBe('2026-11-03');
    expect(rows[0]!.guest_email).toBe('host@example.com');
    expect(rows[0]!.lang).toBe('cs');

    // 2. událost v kalendáři, konec EXCLUSIVE (4. 11., aby 3. 11. bylo obsazené)
    expect(g.events).toHaveLength(1);
    expect(g.events[0]!.summary).toContain('PROVIZORNÍ');
    expect(g.events[0]!.start.date).toBe('2026-10-29');
    expect(g.events[0]!.end.date).toBe('2026-11-04');
    expect(g.events[0]!.description).toContain('host@example.com');
    expect(g.events[0]!.description).toContain('Jazyk komunikace: cs');

    // 3. hostovi NIC neodešlo, Jakubovi přišla žádost o schválení
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0]!.to).toBe('majitel@example.com');
    expect(g.sent[0]!.subject).toContain('[ANDE schválení]');
    expect(g.sent[0]!.body).toContain('/approve/');
    expect(g.sent.some((m) => m.to.includes('example.com') && m.to !== 'majitel@example.com')).toBe(false);
  });

  it('opakovaný běh nezaloží nic dvakrát', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    await runCycle(env, 'test');
    await runCycle(env, 'test');
    expect(res(env.DB)).toHaveLength(1);
    expect(g.events).toHaveLength(1);
    expect(g.sent).toHaveLength(1);
  });

  it('schválení odešle odpověď hostovi, GET odkaz sám o sobě nic neodešle', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    await runCycle(env, 'test');

    const approvalId = (env.DB as never as { dump: (t: string) => { id: string }[] }).dump('approvals')[0]!.id;
    const sig = await sign(env.APPROVAL_SECRET, `${approvalId}:approve`);
    const url = `https://x.workers.dev/approve/${approvalId}?sig=${sig}`;

    const getRes = await worker.fetch(new Request(url), env, CTX);
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toContain('Odeslat hostovi');
    expect(g.sent).toHaveLength(1); // pořád jen žádost o schválení

    const postRes = await worker.fetch(new Request(url, { method: 'POST' }), env, CTX);
    expect(postRes.status).toBe(200);

    expect(g.sent).toHaveLength(2);
    const toGuest = g.sent[1]!;
    expect(toGuest.to).toBe('host@example.com');
    expect(toGuest.subject).toContain('předběžné držení');
    expect(toGuest.body).toContain('celé jméno a příjmení');
    expect(toGuest.body).toContain('telefonní číslo');
    expect(toGuest.threadId).toBe('thread-1');
  });

  it('podvržený nebo chybějící podpis neprojde', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    await runCycle(env, 'test');
    const approvalId = (env.DB as never as { dump: (t: string) => { id: string }[] }).dump('approvals')[0]!.id;

    const bad = await worker.fetch(
      new Request(`https://x.workers.dev/approve/${approvalId}?sig=nesmysl`, { method: 'POST' }),
      env,
      CTX
    );
    expect(bad.status).toBe(400);
    expect(g.sent).toHaveLength(1);

    const none = await worker.fetch(
      new Request(`https://x.workers.dev/approve/${approvalId}`, { method: 'POST' }),
      env,
      CTX
    );
    expect(none.status).toBe(400);
  });

  it('doplnění údajů → potvrzení, úklidový blok a automatický e-mail', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    await runCycle(env, 'test');

    g.addMessage(REPLY);
    g.aiResponse = AI_DETAILS;
    const out = await runCycle(env, 'test');
    expect(out.actions.join(' ')).toContain('rezervace potvrzena');

    const r = res(env.DB)[0]!;
    expect(r.status).toBe('confirmed');
    expect(r.guest_name).toBe('Jan Novák');
    expect(r.guest_phone).toBe('777123456');
    expect(r.arrival_time).toBe('14:00');
    expect(r.hold_expires_at).toBeNull();

    // původní událost přejmenovaná, přibyl úklidový blok 3.–5. 11. (end 6. 11. exclusive)
    expect(g.events).toHaveLength(2);
    const stay = g.events.find((e) => !e.summary.startsWith('ÚKLID'))!;
    const clean = g.events.find((e) => e.summary.startsWith('ÚKLID'))!;
    expect(stay.summary).toBe('Jan Novák (3 osob)');
    expect(stay.summary).not.toContain('PROVIZORNÍ');
    expect(stay.description).toContain('777123456');
    expect(clean.start.date).toBe('2026-11-03');
    expect(clean.end.date).toBe('2026-11-06');
    expect(clean.colorId).toBe('6');

    // potvrzení hostovi odešlo automaticky, bez schvalování
    const conf = g.sent.at(-1)!;
    expect(conf.to).toBe('host@example.com');
    expect(conf.subject).toContain('rezervace potvrzena');
    expect(conf.body).toContain('29. 10. 2026 – 3. 11. 2026');
  });

  it('obsazený termín se sám nedrží ani neodpovídá', async () => {
    g.addEvent({ summary: 'Jiný host (2 osoby)', start: { date: '2026-11-04' }, end: { date: '2026-11-07' } });
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;

    const out = await runCycle(env, 'test');
    expect(out.actions.join(' ')).toContain('termín obsazený');
    expect(res(env.DB)).toHaveLength(0);
    expect(g.events).toHaveLength(1); // nepřibyla žádná
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0]!.to).toBe('majitel@example.com');
    expect(g.sent[0]!.body).toContain('Kolize');
  });

  it('vyjednávání jde vždy ke schválení, nikdy ven samo', async () => {
    g.addMessage({
      id: 'msg-neg',
      threadId: 'thread-9',
      from: 'anna@example.com',
      subject: 'Dotaz – ANDE 1403',
      body: 'Dobrý den, jaká je cena za týden v listopadu a dáte slevu pro 2 osoby?',
    });
    g.aiResponse = {
      kind: 'negotiation' as const,
      lang: 'cs',
      guest_name: 'Anna',
      guest_email: 'anna@example.com',
      guest_phone: null,
      guests_count: 2,
      checkin: null,
      checkout: null,
      arrival_time: null,
      summary: 'Host se ptá na cenu a slevu.',
      proposed_reply: 'Dobrý den Anno, cena za týden je [DOPLNIT].',
      confidence: 0.9,
    };

    const out = await runCycle(env, 'test');
    expect(out.actions.join(' ')).toContain('vyjednávání');
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0]!.to).toBe('majitel@example.com');
    expect(g.sent[0]!.body).toContain('[DOPLNIT]');
    expect(res(env.DB)).toHaveLength(0);
  });

  it('DRY_RUN neodešle ani nezaloží nic, ale všechno zaloguje', async () => {
    env = makeEnv({ OPENAI_API_KEY: 'test-key', DRY_RUN: '1' });
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;

    await runCycle(env, 'test');

    expect(g.sent).toHaveLength(0);
    expect(g.events).toHaveLength(0);
    const outbox = (env.DB as never as { dump: (t: string) => Record<string, unknown>[] }).dump('outbox');
    expect(outbox).toHaveLength(2); // vytvoření události + žádost o schválení
    expect(outbox.every((o) => o.dry_run === 1)).toBe(true);
    expect(res(env.DB)).toHaveLength(1); // rezervace v DB je, jen se neprojevila ven
  });

  it('když spadne kalendář, nezaloží se nic (raději nic než dvojitá rezervace)', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    g.failCalendarList = true;

    const out = await runCycle(env, 'test');
    expect(out.actions.join(' ')).toContain('CHYBA');
    expect(res(env.DB)).toHaveLength(0);
    // zpráva se NEoznačila jako zpracovaná → další běh ji zkusí znovu
    const processed = (env.DB as never as { dump: (t: string) => unknown[] }).dump('processed_messages');
    expect(processed).toHaveLength(0);
  });

  it('bez OpenAI klíče projde tok na samotné heuristice', async () => {
    env = makeEnv(); // bez OPENAI_API_KEY
    g.addMessage(INQUIRY);

    await runCycle(env, 'test');
    expect(g.aiCalls).toBe(0);
    const r = res(env.DB)[0]!;
    expect(r.checkin).toBe('2026-10-29');
    expect(r.checkout).toBe('2026-11-03');
    expect(r.guests_count).toBe(3);
  });
});

describe('časové úlohy', () => {
  async function confirmedReservation(): Promise<void> {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    await runCycle(env, 'test');
    const id = (env.DB as never as { dump: (t: string) => { id: string }[] }).dump('approvals')[0]!.id;
    const sig = await sign(env.APPROVAL_SECRET, `${id}:approve`);
    await worker.fetch(new Request(`https://x/approve/${id}?sig=${sig}`, { method: 'POST' }), env, CTX);
    g.addMessage(REPLY);
    g.aiResponse = AI_DETAILS;
    await runCycle(env, 'test');
  }

  it('den před odjezdem odejdou pokyny, dva dny předem avízo na úklid', async () => {
    await confirmedReservation();
    const before = g.sent.length;

    // 31. 10. — ještě nic (odjezd je 3. 11.)
    expect(await runDailyJobs(env, '2026-10-31')).toEqual([]);
    expect(g.sent).toHaveLength(before);

    // 1. 11. — dva dny před odjezdem → avízo na úklid, hostovi zatím nic
    const day1 = await runDailyJobs(env, '2026-11-01');
    expect(day1.join(' ')).toContain('avízo na úklid');
    expect(day1.join(' ')).not.toContain('pokyny k odjezdu');

    // 2. 11. — den před odjezdem → pokyny hostovi
    const actions = await runDailyJobs(env, '2026-11-02');
    expect(actions.join(' ')).toContain('pokyny k odjezdu');

    const departure = g.sent.find((m) => m.subject.includes('pokyny k odjezdu'))!;
    expect(departure.to).toBe('host@example.com');
    expect(departure.body).toContain('klíče nechte na recepci');
    expect(departure.body).toContain('držáku na zdi');
    expect(departure.body).toContain('poličce u routeru');

    const cleaning = g.sent.find((m) => m.subject.includes('úklid po hostovi'))!;
    expect(cleaning.to).toBe('uklid1@example.com');
    expect(cleaning.headers.cc).toBe('uklid2@example.com');
    expect(cleaning.body).toContain('Jan Novák');

    // opakovaný běh už nic neposílá
    const after = g.sent.length;
    await runDailyJobs(env, '2026-11-02');
    await runDailyJobs(env, '2026-11-03');
    expect(g.sent).toHaveLength(after);
  });

  it('vynechaný běh se dožene (spustí se se zpožděním, ne nikdy)', async () => {
    await confirmedReservation();
    const before = g.sent.length;
    // cron neběžel 2. 11., první běh je až 3. 11. (v den odjezdu)
    const actions = await runDailyJobs(env, '2026-11-03');
    expect(actions.join(' ')).toContain('pokyny k odjezdu');
    expect(g.sent.length).toBeGreaterThan(before);
  });

  it('dohledávka 2 dny před vypršením a pak uvolnění termínu', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    await runCycle(env, 'test');
    const hold = res(env.DB)[0]!.hold_expires_at as string;

    const followupDay = new Date(Date.parse(hold) - 2 * 86400000).toISOString().slice(0, 10);
    const a1 = await runDailyJobs(env, followupDay);
    expect(a1.join(' ')).toContain('dohledávka odeslána');
    const fu = g.sent.at(-1)!;
    expect(fu.to).toBe('host@example.com');
    expect(fu.subject).toContain('ještě platí termín');

    // podruhé už ne
    await runDailyJobs(env, followupDay);
    expect(g.sent.filter((m) => m.subject.includes('ještě platí termín'))).toHaveLength(1);

    // po vypršení se termín uvolní a událost zmizí z kalendáře
    const dayAfter = new Date(Date.parse(hold) + 86400000).toISOString().slice(0, 10);
    const a2 = await runDailyJobs(env, dayAfter);
    expect(a2.join(' ')).toContain('hold vypršel');
    expect(res(env.DB)[0]!.status).toBe('expired');
    expect(g.events).toHaveLength(0);
    expect(g.sent.at(-1)!.to).toBe('majitel@example.com');
  });

  it('nevyřízené schválení se po 36 hodinách připomene', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    await runCycle(env, 'test');
    (env.DB as never as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
      .prepare("UPDATE approvals SET created_at = '2026-01-01T00:00:00.000Z'")
      .run();

    const actions = await runDailyJobs(env, '2026-08-18');
    expect(actions.join(' ')).toContain('připomenuto nevyřízené schválení');
    expect(g.sent.at(-1)!.subject).toContain('čeká na schválení');

    // podruhé už nepřipomíná
    const again = await runDailyJobs(env, '2026-08-19');
    expect(again.join(' ')).not.toContain('připomenuto');
  });
});

describe('HTTP rozhraní', () => {
  it('/health hlásí režim a chybějící secrets (jen názvy, ne hodnoty)', async () => {
    const r = await worker.fetch(new Request('https://x/health'), env, CTX);
    expect(await r.json()).toEqual({ ok: true, dryRun: false, missing: [] });

    const broken = makeEnv({ OWNER_EMAIL: '', CLEANING_EMAILS: '' });
    const r2 = await worker.fetch(new Request('https://x/health'), broken, CTX);
    const body = (await r2.json()) as { ok: boolean; missing: string[] };
    expect(body.ok).toBe(false);
    expect(body.missing).toEqual(['OWNER_EMAIL', 'CLEANING_EMAILS']);
  });

  it('bez OWNER_EMAIL běh spadne dřív, než se cokoliv pošle', async () => {
    const broken = makeEnv({ OPENAI_API_KEY: 'test-key', OWNER_EMAIL: '' });
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;

    await expect(runCycle(broken, 'test')).rejects.toThrow('OWNER_EMAIL');
    expect(g.sent).toHaveLength(0);
    expect(g.events).toHaveLength(0);
    expect(res(broken.DB)).toHaveLength(0);
  });

  it('CLEANING_EMAILS se rozseká a ověří, nesmysly se zahodí', async () => {
    const e = makeEnv({ CLEANING_EMAILS: ' a@b.cz , nesmysl , c@d.cz ' });
    expect(cleaningRecipients(e)).toEqual(['a@b.cz', 'c@d.cz']);
    expect(() => assertConfig(makeEnv({ CLEANING_EMAILS: 'nesmysl' }))).toThrow('CLEANING_EMAILS');
  });

  it('/status a /run vyžadují správný token', async () => {
    const bad = await worker.fetch(new Request('https://x/status?token=nesmysl'), env, CTX);
    expect(bad.status).toBe(403);

    const token = await sign(env.APPROVAL_SECRET, 'status');
    const ok = await worker.fetch(new Request(`https://x/status?token=${encodeURIComponent(token)}`), env, CTX);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Přehled ANDE 1403');
  });

  it('/run spustí stejný cyklus jako cron, ale až po POST', async () => {
    g.addMessage(INQUIRY);
    g.aiResponse = AI_INQUIRY;
    const token = await sign(env.APPROVAL_SECRET, 'status');
    const url = `https://x/run?token=${encodeURIComponent(token)}`;

    await worker.fetch(new Request(url), env, CTX);
    expect(res(env.DB)).toHaveLength(0); // GET nic nespustí

    const post = await worker.fetch(new Request(url, { method: 'POST' }), env, CTX);
    expect(post.status).toBe(200);
    expect(res(env.DB)).toHaveLength(1);
  });

  it('neznámá cesta nic neprozradí', async () => {
    const r = await worker.fetch(new Request('https://x/'), env, CTX);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain('approve');
  });
});
