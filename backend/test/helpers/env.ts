import type { Env } from '../../src/types';
import { FakeD1 } from './d1';

export function makeEnv(overrides: Partial<Env> = {}): Env & { DB: FakeD1 } {
  const db = new FakeD1();
  return {
    DB: db as unknown as D1Database,
    DRY_RUN: '0',
    TIMEZONE: 'Asia/Tbilisi',
    OWNER_EMAIL: 'majitel@example.com',
    MAILBOX_EMAIL: 'ande1403.batumi@gmail.com',
    CLEANING_EMAILS: 'uklid1@example.com,uklid2@example.com',
    CALENDAR_ID: 'kalendar@group.calendar.google.com',
    HOLD_DAYS: '5',
    FOLLOWUP_BEFORE_EXPIRY_DAYS: '2',
    CLEANING_BLOCK_DAYS: '3',
    OPENAI_MODEL: 'gpt-4.1-mini',
    PUBLIC_BASE_URL: 'https://ande1403-backend.example.workers.dev',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csecret',
    GOOGLE_REFRESH_TOKEN: 'rtoken',
    APPROVAL_SECRET: 'test-secret',
    ...overrides,
  } as Env & { DB: FakeD1 };
}

/** Tělo zprávy z Web3Forms — skutečný formát z ostré schránky, hodnoty anonymizované. */
export const WEB3FORMS_BODY = `name : Jan
email : host@example.com
message : 29.10.2026 - 3.11.2026 rezervace 3 osoby`;

/** Odpověď hosta s doplněnými údaji včetně citované historie — skutečný tvar, anonymizovaný. */
export const GUEST_REPLY_BODY = `super, děkuji, Jan Novák, přijedeme cca ve 14:00, telefon je 777123456
(czcech republic)

--
Ing. Jan Novák

email: host@example.com
tel: 777 12 34 56

---------- Původní e‑mail ----------
Od: ande1403 <ande1403.batumi@gmail.com>
Komu: host@example.com
Datum: 16. 8. 2026 14:57:16
Předmět: Re: Rezervace pobytu – ANDE 1403
"
Dobrý den Jane,

děkujeme za zprávu. Termín 29. 10. – 3. 11. 2026 pro 3 osoby máme volný.
"`;
