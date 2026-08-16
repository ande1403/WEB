import type { Env, InboundMessage, OutboundEmail } from '../types';
import { googleFetch } from './auth';
import { base64ToUtf8, chunk76, encodeHeader, htmlToText, toBase64Url, utf8ToBase64 } from '../util/mime';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

function header(parts: { name: string; value: string }[] | undefined, name: string): string | null {
  if (!parts) return null;
  const found = parts.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : null;
}

/** Vytáhne z MIME stromu text — preferuje text/plain, jinak převede HTML. */
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return '';
  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: GmailPart) => {
    const mime = (part.mimeType ?? '').toLowerCase();
    if (part.parts?.length) {
      part.parts.forEach(walk);
      return;
    }
    if (part.filename) return; // příloha
    const data = part.body?.data;
    if (!data) return;
    const text = base64ToUtf8(data);
    if (mime === 'text/plain') plain.push(text);
    else if (mime === 'text/html') html.push(text);
  };

  walk(payload);
  if (plain.length) return plain.join('\n').trim();
  if (html.length) return htmlToText(html.join('\n'));
  return '';
}

export function parseAddress(raw: string | null): { email: string; name: string | null } {
  if (!raw) return { email: '', name: null };
  const m = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { email: (m[2] ?? '').trim().toLowerCase(), name: (m[1] ?? '').trim() || null };
  return { email: raw.trim().toLowerCase(), name: null };
}

export function toInbound(msg: GmailMessage): InboundMessage {
  const headers = msg.payload?.headers;
  const from = parseAddress(header(headers, 'From'));
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: from.email,
    fromName: from.name,
    to: parseAddress(header(headers, 'To')).email,
    subject: header(headers, 'Subject') ?? '',
    date: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
    body: extractBody(msg.payload),
    messageIdHeader: header(headers, 'Message-ID'),
    labelIds: msg.labelIds ?? [],
  };
}

/**
 * Vrátí ID zpráv odpovídajících Gmail dotazu.
 * `in:anywhere` schválně zahrnuje i Spam — odpovědi hostů tam občas spadnou.
 */
export async function searchMessageIds(env: Env, query: string, maxResults = 50): Promise<string[]> {
  const url = `${API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const data = await googleFetch(env, url);
  return (data?.messages ?? []).map((m: { id: string }) => m.id);
}

export async function getMessage(env: Env, id: string): Promise<InboundMessage> {
  const data = (await googleFetch(env, `${API}/messages/${id}?format=full`)) as GmailMessage;
  return toInbound(data);
}

/** Sestaví RFC 2822 zprávu (UTF-8, base64 tělo). */
export function buildRawMessage(mail: OutboundEmail, fromEmail: string, fromName = 'ANDE 1403'): string {
  const lines = [
    `From: ${encodeHeader(fromName)} <${fromEmail}>`,
    `To: ${mail.to}`,
  ];
  if (mail.cc) lines.push(`Cc: ${mail.cc}`);
  lines.push(`Subject: ${encodeHeader(mail.subject)}`);
  if (mail.inReplyTo) {
    lines.push(`In-Reply-To: ${mail.inReplyTo}`);
    lines.push(`References: ${mail.inReplyTo}`);
  }
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(chunk76(utf8ToBase64(mail.body)));
  return lines.join('\r\n');
}

export async function sendEmail(env: Env, mail: OutboundEmail): Promise<{ id: string; threadId: string }> {
  const raw = toBase64Url(utf8ToBase64(buildRawMessage(mail, env.MAILBOX_EMAIL)));
  const body: Record<string, unknown> = { raw };
  if (mail.threadId) body.threadId = mail.threadId;
  const data = await googleFetch(env, `${API}/messages/send`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { id: data.id, threadId: data.threadId };
}
