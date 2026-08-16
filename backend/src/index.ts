import type { Env } from './types';
import { searchMessageIds, getMessage } from './google/gmail';
import { processMessage } from './workflow/inbound';
import { runDailyJobs } from './workflow/daily';
import { executeApproval, loadApproval, rejectApproval } from './workflow/approvals';
import { finishJob, recentJobs, recentOutbox, startJob, wasProcessed } from './storage/db';
import { sign, verify } from './util/crypto';
import { today as todayIn } from './util/dates';
import { assertConfig, requiredSecrets } from './util/config';
import { isDryRun } from './gateway';
import { page, escapeHtml, statusPage } from './ui';

/**
 * Vstupní bod Workeru.
 *   scheduled() — každých 30 minut: přečti schránku, zpracuj nové zprávy, udělej časové úlohy.
 *   fetch()     — schvalovací odkazy z e-mailu + přehledová stránka + ruční spuštění.
 */

const GMAIL_QUERY = 'in:anywhere -in:sent -in:drafts -in:chats newer_than:21d';

/**
 * Volitelný "dead man's switch": po každém úspěšném běhu se pingne externí URL
 * (např. healthchecks.io). Když Workeru vyprší Google token nebo cron přestane běžet,
 * systém by jinak tiše zmlkl — a mlčení vypadá stejně jako "nic nepřišlo".
 * Ping se dělá až po úspěšném běhu a jeho selhání nikdy neshodí cyklus.
 */
async function pingHealthcheck(env: Env): Promise<void> {
  if (!env.HEALTHCHECK_URL) return;
  try {
    await fetch(env.HEALTHCHECK_URL, { method: 'GET' });
  } catch (err) {
    console.error('Healthcheck ping selhal:', (err as Error).message);
  }
}

export async function runCycle(env: Env, trigger: string): Promise<{ actions: string[]; seen: number }> {
  const jobId = await startJob(env, trigger);
  const actions: string[] = [];
  let seen = 0;

  try {
    assertConfig(env);
    const today = todayIn(env.TIMEZONE || 'Asia/Tbilisi');

    const ids = await searchMessageIds(env, GMAIL_QUERY, 50);
    seen = ids.length;

    for (const id of ids) {
      try {
        // Levná kontrola dřív, než sáhneme na plné tělo zprávy — většina ID v každém
        // běhu už je zpracovaná a stahovat je znovu by jen pálilo Gmail kvótu.
        if (await wasProcessed(env, id)) continue;
        const msg = await getMessage(env, id);
        const result = await processMessage(env, msg, today);
        if (result) actions.push(`${result.kind}: ${result.action} [${msg.from}]`);
      } catch (err) {
        // Jedna rozbitá zpráva nesmí shodit celý běh — a hlavně se NESMÍ označit
        // jako zpracovaná, aby ji další běh zkusil znovu.
        actions.push(`CHYBA u zprávy ${id}: ${(err as Error).message}`);
        console.error('zpráva', id, err);
      }
    }

    actions.push(...(await runDailyJobs(env, today)));
    await finishJob(env, jobId, { ok: true, messages_seen: seen, actions });
    await pingHealthcheck(env);
    return { actions, seen };
  } catch (err) {
    await finishJob(env, jobId, { ok: false, messages_seen: seen, actions, error: (err as Error).message });
    throw err;
  }
}

async function checkSig(env: Env, id: string, action: string, sig: string | null): Promise<boolean> {
  if (!sig) return false;
  return verify(env.APPROVAL_SECRET, `${id}:${action}`, sig);
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCycle(env, 'cron').catch(async (err) => {
        console.error('Běh cronu selhal:', err);
      })
    );
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (url.pathname === '/health') {
      // Názvy chybějících secrets jsou v pořádku ukázat — hodnoty ne.
      const missing = requiredSecrets(env);
      return new Response(JSON.stringify({ ok: missing.length === 0, dryRun: isDryRun(env), missing }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // --- schvalování ---------------------------------------------------------
    if ((parts[0] === 'approve' || parts[0] === 'reject') && parts[1]) {
      const action = parts[0];
      const id = parts[1];
      const sig = url.searchParams.get('sig');

      if (!(await checkSig(env, id, action, sig))) {
        return page('Neplatný odkaz', '<p>Podpis odkazu nesedí. Otevři odkaz přímo z e-mailu.</p>', 400);
      }

      const approval = await loadApproval(env, id);
      if (!approval) return page('Nenalezeno', '<p>Tahle položka ke schválení už neexistuje.</p>', 404);

      if (request.method === 'GET') {
        // Samotné otevření odkazu nic neprovede — proti předběžnému načítání odkazů
        // e-mailovými klienty. Akci spustí až odeslání formuláře.
        const label = action === 'approve' ? 'Odeslat hostovi' : 'Zamítnout';
        const status =
          approval.status === 'pending'
            ? ''
            : `<p class="warn">Pozor: tahle položka už má stav <b>${escapeHtml(approval.status)}</b>.</p>`;
        return page(
          action === 'approve' ? 'Schválit odpověď' : 'Zamítnout odpověď',
          `${status}
           <p><b>Komu:</b> ${escapeHtml(approval.to_email)}</p>
           <p><b>Předmět:</b> ${escapeHtml(approval.subject)}</p>
           <pre>${escapeHtml(approval.body)}</pre>
           ${isDryRun(env) ? '<p class="warn">Systém běží v režimu DRY_RUN — i po schválení se e-mail reálně neodešle.</p>' : ''}
           <form method="post"><button type="submit">${label}</button></form>`
        );
      }

      if (request.method === 'POST') {
        try {
          const msg = action === 'approve' ? await executeApproval(env, approval) : await rejectApproval(env, approval);
          return page('Hotovo', `<p>${escapeHtml(msg)}</p>`);
        } catch (err) {
          return page('Nepovedlo se', `<pre>${escapeHtml((err as Error).message)}</pre>`, 500);
        }
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // --- přehled + ruční spuštění -------------------------------------------
    if (url.pathname === '/status' || url.pathname === '/run') {
      const token = url.searchParams.get('token');
      const expected = await sign(env.APPROVAL_SECRET, 'status');
      if (token !== expected) {
        return page('Neplatný token', '<p>Chybí nebo nesedí token.</p>', 403);
      }

      if (url.pathname === '/run') {
        if (request.method !== 'POST') {
          return page(
            'Ruční spuštění',
            `<p>Spustí stejný cyklus jako cron: načte schránku, zpracuje nové zprávy a provede časové úlohy.</p>
             ${isDryRun(env) ? '<p class="warn">DRY_RUN je zapnutý — nic se reálně neodešle.</p>' : '<p class="warn">DRY_RUN je vypnutý — e-maily odejdou doopravdy.</p>'}
             <form method="post"><button type="submit">Spustit teď</button></form>`
          );
        }
        const res = await runCycle(env, 'manual');
        return page(
          'Běh dokončen',
          `<p>Zpráv ve schránce k prohlédnutí: ${res.seen}</p><pre>${escapeHtml(
            res.actions.join('\n') || '(žádné akce)'
          )}</pre>`
        );
      }

      return statusPage(env, {
        jobs: await recentJobs(env, 10),
        outbox: await recentOutbox(env, 30),
      });
    }

    return page(
      'ANDE 1403 backend',
      '<p>Tenhle Worker obsluhuje automatizaci rezervací. Veřejně tu není nic k vidění.</p>',
      404
    );
  },
};
