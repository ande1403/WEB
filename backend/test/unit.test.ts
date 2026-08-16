import { describe, expect, it } from 'vitest';
import {
  addDays,
  cleaningBlock,
  diffDays,
  formatDate,
  nextPossibleCheckin,
  overlapsInclusive,
  toExclusiveEnd,
  today,
} from '../src/util/dates';
import {
  extractArrivalTime,
  extractDateRange,
  extractGuestCount,
  extractPhone,
  guessLang,
  parseWeb3Forms,
  stripQuoted,
} from '../src/util/text';
import { heuristicClassify, mergeClassification } from '../src/ai/classify';
import { buildRawMessage, parseAddress, toInbound } from '../src/google/gmail';
import { parseSent } from './helpers/fakeGoogle';
import { GUEST_REPLY_BODY, WEB3FORMS_BODY, makeEnv } from './helpers/env';
import { sign, verify } from '../src/util/crypto';

describe('datumová konvence (exclusive end)', () => {
  it('checkout 3. 11. se v kalendáři zapíše jako end 4. 11.', () => {
    expect(toExclusiveEnd('2026-11-03')).toBe('2026-11-04');
  });

  it('úklidový blok pokrývá den odjezdu + 2 dny', () => {
    const b = cleaningBlock('2026-11-03', 3);
    expect(b.start).toBe('2026-11-03');
    expect(b.endExclusive).toBe('2026-11-06'); // 3., 4., 5. 11. obsazeno
  });

  it('další host může nejdřív 6. 11.', () => {
    expect(nextPossibleCheckin('2026-11-03', 3)).toBe('2026-11-06');
  });

  it('addDays/diffDays přežijí přechod na zimní čas', () => {
    expect(addDays('2026-10-24', 3)).toBe('2026-10-27');
    expect(diffDays('2026-10-24', '2026-10-27')).toBe(3);
  });

  it('překryv intervalů', () => {
    expect(overlapsInclusive('2026-11-01', '2026-11-05', '2026-11-05', '2026-11-09')).toBe(true);
    expect(overlapsInclusive('2026-11-01', '2026-11-05', '2026-11-06', '2026-11-09')).toBe(false);
  });

  it('formát data podle jazyka', () => {
    expect(formatDate('2026-11-03', 'cs')).toBe('3. 11. 2026');
    expect(formatDate('2026-11-03', 'ru')).toBe('03.11.2026');
    expect(formatDate('2026-11-03', 'en')).toBe('2026-11-03');
  });

  it('today vrací datum v zóně bytu', () => {
    // 22:30 UTC = už další den v Batumi (UTC+4)
    expect(today('Asia/Tbilisi', new Date('2026-08-16T22:30:00Z'))).toBe('2026-08-17');
    expect(today('Europe/Prague', new Date('2026-08-16T22:30:00Z'))).toBe('2026-08-17');
  });
});

describe('parsování textu', () => {
  it('rozebere reálné tělo z Web3Forms', () => {
    const f = parseWeb3Forms(WEB3FORMS_BODY);
    expect(f).not.toBeNull();
    expect(f!.email).toBe('host@example.com');
    expect(f!.name).toBe('Jan');
    expect(f!.message).toContain('29.10.2026');
  });

  it('vytáhne termín z volného textu', () => {
    expect(extractDateRange('29.10.2026 - 3.11.2026 rezervace 3 osoby', 2026)).toEqual({
      from: '2026-10-29',
      to: '2026-11-03',
    });
    expect(extractDateRange('od 29. 10. do 3. 11. 2026', 2026)).toEqual({
      from: '2026-10-29',
      to: '2026-11-03',
    });
    expect(extractDateRange('2026-10-29 to 2026-11-03', 2026)).toEqual({
      from: '2026-10-29',
      to: '2026-11-03',
    });
    expect(extractDateRange('rád bych někdy na podzim', 2026)).toBeNull();
  });

  it('vytáhne počet osob, telefon a čas příjezdu', () => {
    expect(extractGuestCount('rezervace 3 osoby')).toBe(3);
    expect(extractGuestCount('4 guests please')).toBe(4);
    expect(extractPhone('telefon je 777123456')).toBe('777123456');
    expect(extractArrivalTime('přijedeme cca ve 14:00')).toBe('14:00');
    expect(extractArrivalTime('around 3 pm')).toBe('15:00');
  });

  it('odřízne citovanou historii z odpovědi', () => {
    const clean = stripQuoted(GUEST_REPLY_BODY);
    expect(clean).toContain('777123456');
    expect(clean).not.toContain('Původní e‑mail');
    expect(clean).not.toContain('děkujeme za zprávu');
  });

  it('odhadne jazyk podle písma', () => {
    expect(guessLang('Dobrý den, chtěl bych rezervaci')).toBe('cs');
    expect(guessLang('Dzień dobry, proszę o rezerwację')).toBe('pl');
    expect(guessLang('Здравствуйте, хочу забронировать')).toBe('ru');
    expect(guessLang('გამარჯობა')).toBe('ka');
    expect(guessLang('שלום')).toBe('he');
    expect(guessLang('Hello, I would like to book')).toBe('en');
  });
});

describe('klasifikace', () => {
  it('heuristika sama rozpozná novou poptávku z formuláře', () => {
    const c = heuristicClassify(
      {
        id: 'm1',
        threadId: 't1',
        from: 'notify+abc@web3forms.com',
        fromName: 'ANDE 1403 · web',
        to: 'ande1403.batumi@gmail.com',
        subject: 'Rezervace pobytu – ANDE 1403',
        date: '2026-08-16T12:06:09Z',
        body: WEB3FORMS_BODY,
        messageIdHeader: '<x@mail>',
        labelIds: ['INBOX'],
      },
      '2026-08-16'
    );
    expect(c.kind).toBe('new_inquiry');
    expect(c.guest_email).toBe('host@example.com');
    expect(c.checkin).toBe('2026-10-29');
    expect(c.checkout).toBe('2026-11-03');
    expect(c.guests_count).toBe(3);
    expect(c.lang).toBe('cs');
  });

  it('e-mail hosta z formuláře přebije to, co vrátí model', () => {
    const base = heuristicClassify(
      {
        id: 'm1',
        threadId: 't1',
        from: 'notify+abc@web3forms.com',
        fromName: null,
        to: 'x',
        subject: 's',
        date: '2026-08-16T12:00:00Z',
        body: WEB3FORMS_BODY,
        messageIdHeader: null,
        labelIds: [],
      },
      '2026-08-16'
    );
    const merged = mergeClassification(base, { guest_email: 'halucinace@example.com', kind: 'new_inquiry' });
    expect(merged.guest_email).toBe('host@example.com');
  });

  it('nesmyslné datum z modelu se zahodí a použije se heuristika', () => {
    const base = heuristicClassify(
      {
        id: 'm1',
        threadId: 't1',
        from: 'a@b.cz',
        fromName: null,
        to: 'x',
        subject: 's',
        date: '2026-08-16T12:00:00Z',
        body: 'termín 29.10.2026 - 3.11.2026',
        messageIdHeader: null,
        labelIds: [],
      },
      '2026-08-16'
    );
    const merged = mergeClassification(base, { checkin: 'brzy', checkout: '2026-13-45' });
    expect(merged.checkin).toBe('2026-10-29');
    expect(merged.checkout).toBe('2026-11-03');
  });
});

describe('Gmail vrstva', () => {
  it('rozebere adresu odesílatele', () => {
    expect(parseAddress('"Ing. Jan Novák" <host@example.com>')).toEqual({
      email: 'host@example.com',
      name: 'Ing. Jan Novák',
    });
    expect(parseAddress('a@b.cz').email).toBe('a@b.cz');
  });

  it('vytáhne text/plain z multipart zprávy', () => {
    const msg = toInbound({
      id: 'm1',
      threadId: 't1',
      internalDate: String(Date.parse('2026-08-16T12:00:00Z')),
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'ANDE web <notify@web3forms.com>' },
          { name: 'Subject', value: 'Rezervace' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('čistý text').toString('base64url') } },
          { mimeType: 'text/html', body: { data: Buffer.from('<p>html</p>').toString('base64url') } },
        ],
      },
    } as never);
    expect(msg.body).toBe('čistý text');
    expect(msg.from).toBe('notify@web3forms.com');
  });

  it('sestaví RFC822 zprávu s diakritikou a hebrejštinou', () => {
    const raw = buildRawMessage(
      { to: 'host@example.com', subject: 'Rezervace potvrzena – 3. 11.', body: 'שלום, זה עובד\nDobrý den' },
      'ande1403.batumi@gmail.com'
    );
    const encoded = Buffer.from(raw, 'utf8').toString('base64url');
    const parsed = parseSent(encoded);
    expect(parsed.subject).toBe('Rezervace potvrzena – 3. 11.');
    expect(parsed.body).toContain('שלום, זה עובד');
    expect(parsed.body).toContain('Dobrý den');
    expect(parsed.headers.from).toContain('ande1403.batumi@gmail.com');
  });
});

describe('podpisy schvalovacích odkazů', () => {
  it('platný podpis projde, cizí ne', async () => {
    const env = makeEnv();
    const sig = await sign(env.APPROVAL_SECRET, 'abc:approve');
    expect(await verify(env.APPROVAL_SECRET, 'abc:approve', sig)).toBe(true);
    expect(await verify(env.APPROVAL_SECRET, 'abc:reject', sig)).toBe(false);
    expect(await verify('jiny-secret', 'abc:approve', sig)).toBe(false);
    expect(await verify(env.APPROVAL_SECRET, 'abc:approve', 'nesmysl')).toBe(false);
  });
});
