import type { Env } from './types';
import { isDryRun } from './gateway';

/** Minimální HTML stránky pro schvalovací odkazy a přehled. Žádný JS, žádné externí zdroje. */

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
:root { color-scheme: light }
body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 780px; margin: 0 auto;
       padding: 28px 18px 60px; color: #1c2b2f; background: #fbfaf7; line-height: 1.55 }
h1 { font-size: 1.35rem; letter-spacing: .01em; margin: 0 0 18px }
h2 { font-size: 1.05rem; margin: 28px 0 8px }
pre { background: #fff; border: 1px solid #e3e0d8; border-radius: 8px; padding: 12px;
      white-space: pre-wrap; word-break: break-word; font-size: .88rem }
button { background: #0b4a55; color: #fff; border: 0; border-radius: 8px; padding: 11px 20px;
         font-size: 1rem; cursor: pointer }
.warn { background: #fff5e0; border: 1px solid #f0d9a8; border-radius: 8px; padding: 10px 12px }
table { border-collapse: collapse; width: 100%; font-size: .85rem; background: #fff }
th, td { border: 1px solid #e3e0d8; padding: 6px 8px; text-align: left; vertical-align: top }
th { background: #f2efe8 }
.small { color: #6b7a7e; font-size: .82rem }
`;

export function page(title: string, bodyHtml: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} — ANDE 1403</title><style>${CSS}</style></head>
<body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

function table(rows: Record<string, unknown>[], cols: string[]): string {
  if (!rows.length) return '<p class="small">(prázdné)</p>';
  const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(r[c]).slice(0, 400)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export async function statusPage(
  env: Env,
  data: { jobs: Record<string, unknown>[]; outbox: Record<string, unknown>[] }
): Promise<Response> {
  const res = await env.DB.prepare(
    `SELECT id, status, guest_name, guest_email, guests_count, lang, checkin, checkout,
            guest_phone, arrival_time, hold_expires_at, cleaning_event_id
       FROM reservations ORDER BY checkin DESC LIMIT 50`
  ).all();
  const approvals = await env.DB.prepare(
    `SELECT id, created_at, status, kind, to_email, subject FROM approvals ORDER BY created_at DESC LIMIT 20`
  ).all();

  return page(
    'Přehled ANDE 1403',
    `${isDryRun(env) ? '<p class="warn">DRY_RUN je <b>zapnutý</b> — Worker nic neodesílá ani nezapisuje do kalendáře.</p>' : '<p class="warn">DRY_RUN je <b>vypnutý</b> — ostrý provoz.</p>'}
     <h2>Rezervace</h2>
     ${table((res.results ?? []) as Record<string, unknown>[], [
       'id',
       'status',
       'checkin',
       'checkout',
       'guest_name',
       'guest_email',
       'guests_count',
       'lang',
       'guest_phone',
       'arrival_time',
       'hold_expires_at',
     ])}
     <h2>Čeká na schválení / historie schvalování</h2>
     ${table((approvals.results ?? []) as Record<string, unknown>[], [
       'created_at',
       'status',
       'kind',
       'to_email',
       'subject',
     ])}
     <h2>Poslední běhy</h2>
     ${table(data.jobs, ['started_at', 'ok', 'trigger', 'messages_seen', 'actions', 'error'])}
     <h2>Odchozí akce (outbox)</h2>
     ${table(data.outbox, ['created_at', 'dry_run', 'channel', 'action', 'ref', 'result'])}`
  );
}
