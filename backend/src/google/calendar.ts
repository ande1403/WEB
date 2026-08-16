import type { Env } from '../types';
import { googleFetch } from './auth';
import { fromExclusiveEnd } from '../util/dates';

const API = 'https://www.googleapis.com/calendar/v3';

/** colorId 6 = Tangerine — barva vyhrazená pro úklidové bloky (dohoda projektu). */
export const CLEANING_COLOR_ID = '6';

export interface CalEvent {
  id: string;
  summary: string;
  description: string | null;
  /** inclusive první den */
  start: string;
  /** inclusive poslední den (už převedeno z exclusive end.date) */
  end: string;
  colorId: string | null;
  status: string;
}

interface RawEvent {
  id: string;
  summary?: string;
  description?: string;
  colorId?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

function toCalEvent(e: RawEvent): CalEvent | null {
  const startDate = e.start?.date ?? e.start?.dateTime?.slice(0, 10);
  const endRaw = e.end?.date ?? e.end?.dateTime?.slice(0, 10);
  if (!startDate || !endRaw) return null;
  // all-day: end.date je exclusive; timed: bereme den konce jak je
  const end = e.end?.date ? fromExclusiveEnd(endRaw) : endRaw;
  return {
    id: e.id,
    summary: e.summary ?? '',
    description: e.description ?? null,
    start: startDate,
    end,
    colorId: e.colorId ?? null,
    status: e.status ?? 'confirmed',
  };
}

export async function listEvents(env: Env, timeMinDate: string, timeMaxDate: string): Promise<CalEvent[]> {
  const params = new URLSearchParams({
    timeMin: `${timeMinDate}T00:00:00Z`,
    timeMax: `${timeMaxDate}T00:00:00Z`,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const url = `${API}/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events?${params}`;
  const data = await googleFetch(env, url);
  return ((data?.items ?? []) as RawEvent[])
    .filter((e) => e.status !== 'cancelled')
    .map(toCalEvent)
    .filter((e): e is CalEvent => e !== null);
}

export interface NewEvent {
  summary: string;
  description?: string;
  /** inclusive první den */
  start: string;
  /** EXCLUSIVE konec — volající musí předat checkout + 1 (viz util/dates). */
  endExclusive: string;
  colorId?: string;
}

export async function createEvent(env: Env, ev: NewEvent): Promise<{ id: string }> {
  const url = `${API}/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events`;
  const data = await googleFetch(env, url, {
    method: 'POST',
    body: JSON.stringify({
      summary: ev.summary,
      description: ev.description ?? '',
      start: { date: ev.start },
      end: { date: ev.endExclusive },
      ...(ev.colorId ? { colorId: ev.colorId } : {}),
      transparency: 'opaque',
    }),
  });
  return { id: data.id };
}

export async function patchEvent(
  env: Env,
  eventId: string,
  patch: Partial<NewEvent>
): Promise<{ id: string }> {
  const url = `${API}/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`;
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.start !== undefined) body.start = { date: patch.start };
  if (patch.endExclusive !== undefined) body.end = { date: patch.endExclusive };
  if (patch.colorId !== undefined) body.colorId = patch.colorId;
  const data = await googleFetch(env, url, { method: 'PATCH', body: JSON.stringify(body) });
  return { id: data.id };
}

export async function deleteEvent(env: Env, eventId: string): Promise<void> {
  const url = `${API}/calendars/${encodeURIComponent(env.CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`;
  await googleFetch(env, url, { method: 'DELETE' });
}
