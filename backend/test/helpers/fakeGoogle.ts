import type { Classification } from '../../src/types';

/**
 * Falešné Google + OpenAI API. Nahradí globalThis.fetch, takže testy projdou
 * úplně stejným kódem jako ostrý provoz (auth → Gmail → Calendar), jen bez sítě.
 */

export interface FakeMessage {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  body: string;
  /** true = tělo se vloží jako text/plain část, jinak jako jednoduchý payload */
  multipart?: boolean;
  internalDate?: number;
  labelIds?: string[];
  messageIdHeader?: string;
}

export interface FakeCalEvent {
  id: string;
  summary: string;
  description?: string;
  start: { date: string };
  end: { date: string };
  colorId?: string;
  status?: string;
}

export interface SentMail {
  raw: string;
  threadId?: string;
  to: string;
  subject: string;
  body: string;
  headers: Record<string, string>;
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeHeaderWord(v: string): string {
  return v.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
}

/** Rozebere odeslanou RFC822 zprávu zpět na to/subject/body — pro kontrolu v testech. */
export function parseSent(raw: string): { to: string; subject: string; body: string; headers: Record<string, string> } {
  const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const [head, ...rest] = decoded.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of (head ?? '').split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = decodeHeaderWord(line.slice(i + 1).trim());
  }
  const bodyB64 = rest.join('\r\n\r\n').replace(/\r\n/g, '');
  const body = Buffer.from(bodyB64, 'base64').toString('utf8');
  return { to: headers.to ?? '', subject: headers.subject ?? '', body, headers };
}

export class FakeGoogle {
  messages: FakeMessage[] = [];
  events: FakeCalEvent[] = [];
  sent: SentMail[] = [];
  aiResponse: Partial<Classification> | null = null;
  aiCalls = 0;
  failCalendarList = false;
  private seq = 0;

  addMessage(m: FakeMessage): void {
    this.messages.push(m);
  }

  addEvent(e: Omit<FakeCalEvent, 'id'> & { id?: string }): FakeCalEvent {
    const ev = { id: e.id ?? `evt${++this.seq}`, ...e } as FakeCalEvent;
    this.events.push(ev);
    return ev;
  }

  private gmailPayload(m: FakeMessage) {
    const headers = [
      { name: 'From', value: m.from },
      { name: 'To', value: m.to ?? 'ande1403.batumi@gmail.com' },
      { name: 'Subject', value: m.subject },
      { name: 'Message-ID', value: m.messageIdHeader ?? `<${m.id}@mail>` },
    ];
    if (m.multipart) {
      return {
        mimeType: 'multipart/alternative',
        headers,
        parts: [
          { mimeType: 'text/plain', body: { data: b64url(m.body) } },
          { mimeType: 'text/html', body: { data: b64url(`<p>${m.body}</p>`) } },
        ],
      };
    }
    return { mimeType: 'text/plain', headers, body: { data: b64url(m.body) } };
  }

  install(): void {
    const self = this;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

      // --- OAuth ---
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return json({ access_token: 'fake-access-token', expires_in: 3600 });
      }

      // --- Gmail ---
      if (url.includes('gmail.googleapis.com')) {
        if (url.includes('/messages/send')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as { raw: string; threadId?: string };
          const parsed = parseSent(body.raw);
          self.sent.push({ raw: body.raw, threadId: body.threadId, ...parsed });
          return json({ id: `sent${++self.seq}`, threadId: body.threadId ?? `thr${self.seq}` });
        }
        const listMatch = url.match(/\/messages\?/);
        if (listMatch) {
          return json({ messages: self.messages.map((m) => ({ id: m.id, threadId: m.threadId })) });
        }
        const getMatch = url.match(/\/messages\/([^?]+)/);
        if (getMatch) {
          const m = self.messages.find((x) => x.id === decodeURIComponent(getMatch[1]!));
          if (!m) return json({ error: 'not found' }, 404);
          return json({
            id: m.id,
            threadId: m.threadId,
            labelIds: m.labelIds ?? ['INBOX'],
            internalDate: String(m.internalDate ?? Date.parse('2026-08-16T12:00:00Z')),
            payload: self.gmailPayload(m),
          });
        }
      }

      // --- Calendar ---
      if (url.includes('googleapis.com/calendar/v3')) {
        if (method === 'GET') {
          if (self.failCalendarList) return json({ error: 'boom' }, 500);
          const u = new URL(url);
          const min = (u.searchParams.get('timeMin') ?? '0000-01-01').slice(0, 10);
          const max = (u.searchParams.get('timeMax') ?? '9999-12-31').slice(0, 10);
          const items = self.events.filter((e) => e.start.date < max && e.end.date > min);
          return json({ items });
        }
        if (method === 'POST') {
          const b = JSON.parse(String(init?.body ?? '{}'));
          const ev: FakeCalEvent = { id: `evt${++self.seq}`, status: 'confirmed', ...b };
          self.events.push(ev);
          return json(ev);
        }
        if (method === 'PATCH') {
          const id = decodeURIComponent(url.split('/events/')[1]!.split('?')[0]!);
          const ev = self.events.find((e) => e.id === id);
          if (!ev) return json({ error: 'not found' }, 404);
          Object.assign(ev, JSON.parse(String(init?.body ?? '{}')));
          return json(ev);
        }
        if (method === 'DELETE') {
          const id = decodeURIComponent(url.split('/events/')[1]!.split('?')[0]!);
          self.events = self.events.filter((e) => e.id !== id);
          return new Response('', { status: 204 });
        }
      }

      // --- OpenAI ---
      if (url.startsWith('https://api.openai.com')) {
        self.aiCalls++;
        if (!self.aiResponse) return json({ error: 'no ai configured' }, 500);
        return json({ choices: [{ message: { content: JSON.stringify(self.aiResponse) } }] });
      }

      throw new Error(`Neočekávaný fetch v testu: ${method} ${url}`);
    }) as typeof fetch;
  }
}
