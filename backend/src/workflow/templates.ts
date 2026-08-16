import type { Lang } from '../types';
import { formatDate } from '../util/dates';

/**
 * Texty e-mailů pro hosty v 6 jazycích webu.
 *
 * TODO(kontrola rodilým mluvčím): gruzínské (ka) a hebrejské (he) verze napsal model,
 * nejsou ověřené rodilým mluvčím. Než se vypne DRY_RUN, projít.
 *
 * Záměrně tu nejsou žádné konkrétní údaje o bytě (adresa, cena, Wi-Fi, kód od dveří) —
 * ty do automatických e-mailů nepatří, dokud je Jakub nedodá.
 */

export interface TplCtx {
  name: string | null;
  checkin: string;
  checkout: string;
  guests?: number | null;
  holdExpiry?: string;
  nextCheckin?: string | null;
}

export interface Mail {
  subject: string;
  body: string;
}

const HELLO: Record<Lang, (n: string | null) => string> = {
  cs: (n) => (n ? `Dobrý den, ${n},` : 'Dobrý den,'),
  en: (n) => (n ? `Hello ${n},` : 'Hello,'),
  pl: (n) => (n ? `Dzień dobry, ${n},` : 'Dzień dobry,'),
  ru: (n) => (n ? `Здравствуйте, ${n},` : 'Здравствуйте,'),
  ka: (n) => (n ? `გამარჯობა, ${n},` : 'გამარჯობა,'),
  he: (n) => (n ? `שלום ${n},` : 'שלום,'),
};

const SIGN: Record<Lang, string> = {
  cs: 'S pozdravem\nANDE 1403 · Batumi',
  en: 'Best regards,\nANDE 1403 · Batumi',
  pl: 'Z pozdrowieniami\nANDE 1403 · Batumi',
  ru: 'С уважением,\nANDE 1403 · Batumi',
  ka: 'პატივისცემით,\nANDE 1403 · ბათუმი',
  he: 'בברכה,\nANDE 1403 · באטומי',
};

function range(lang: Lang, ctx: TplCtx): string {
  return `${formatDate(ctx.checkin, lang)} – ${formatDate(ctx.checkout, lang)}`;
}

/* ---------------------------------------------- 1. první odpověď (VŽDY ke schválení) */

export function firstReply(lang: Lang, ctx: TplCtx): Mail {
  const r = range(lang, ctx);
  const exp = ctx.holdExpiry ? formatDate(ctx.holdExpiry, lang) : '';
  const hi = HELLO[lang](ctx.name);
  const sign = SIGN[lang];

  const bodies: Record<Lang, string> = {
    cs: `${hi}

děkujeme za zájem o apartmán ANDE 1403 v Batumi.

Termín ${r} je volný a předběžně jsme ho pro vás podrželi do ${exp}.

Abychom rezervaci mohli potvrdit, potřebujeme ještě tyto údaje:
• celé jméno a příjmení
• telefonní číslo
• předpokládaný čas příjezdu

Stačí odpovědět na tento e-mail. Pokud se do ${exp} neozvete, termín zase uvolníme.

${sign}`,
    en: `${hi}

thank you for your interest in the ANDE 1403 apartment in Batumi.

The dates ${r} are available and we have put a provisional hold on them for you until ${exp}.

To confirm the booking we still need:
• your full name
• a phone number
• your estimated time of arrival

Simply reply to this e-mail. If we do not hear from you by ${exp}, the dates will be released.

${sign}`,
    pl: `${hi}

dziękujemy za zainteresowanie apartamentem ANDE 1403 w Batumi.

Termin ${r} jest wolny i wstępnie zarezerwowaliśmy go dla Państwa do ${exp}.

Aby potwierdzić rezerwację, potrzebujemy jeszcze:
• imienia i nazwiska
• numeru telefonu
• przewidywanej godziny przyjazdu

Wystarczy odpowiedzieć na tego e-maila. Jeśli nie otrzymamy odpowiedzi do ${exp}, termin zostanie zwolniony.

${sign}`,
    ru: `${hi}

благодарим за интерес к апартаменту ANDE 1403 в Батуми.

Даты ${r} свободны, мы предварительно забронировали их для вас до ${exp}.

Чтобы подтвердить бронирование, нам ещё нужны:
• имя и фамилия
• номер телефона
• предполагаемое время приезда

Просто ответьте на это письмо. Если мы не получим ответ до ${exp}, даты снова освободятся.

${sign}`,
    ka: `${hi}

გმადლობთ ბათუმში ბინა ANDE 1403-ით დაინტერესებისთვის.

თარიღები ${r} თავისუფალია და ჩვენ ისინი წინასწარ დაგიჯავშნეთ ${exp}-მდე.

ჯავშნის დასადასტურებლად გვჭირდება:
• სახელი და გვარი
• ტელეფონის ნომერი
• ჩამოსვლის სავარაუდო დრო

უბრალოდ უპასუხეთ ამ წერილს. თუ ${exp}-მდე პასუხს არ მივიღებთ, თარიღები კვლავ გათავისუფლდება.

${sign}`,
    he: `${hi}

תודה על התעניינותכם בדירה ANDE 1403 בבאטומי.

התאריכים ${r} פנויים ושמרנו אותם עבורכם באופן זמני עד ${exp}.

כדי לאשר את ההזמנה אנחנו זקוקים עוד ל:
• שם מלא
• מספר טלפון
• שעת הגעה משוערת

אפשר פשוט להשיב למייל הזה. אם לא נקבל תשובה עד ${exp}, התאריכים ישוחררו.

${sign}`,
  };

  const subjects: Record<Lang, string> = {
    cs: `ANDE 1403 – předběžné držení termínu ${r}`,
    en: `ANDE 1403 – dates ${r} provisionally held`,
    pl: `ANDE 1403 – wstępna rezerwacja terminu ${r}`,
    ru: `ANDE 1403 – предварительное бронирование ${r}`,
    ka: `ANDE 1403 – წინასწარი ჯავშანი ${r}`,
    he: `ANDE 1403 – שמירת תאריכים ${r}`,
  };

  return { subject: subjects[lang], body: bodies[lang] };
}

/* ------------------------------------------------------- 2. dohledávka (automaticky) */

export function followUp(lang: Lang, ctx: TplCtx): Mail {
  const r = range(lang, ctx);
  const exp = ctx.holdExpiry ? formatDate(ctx.holdExpiry, lang) : '';
  const hi = HELLO[lang](ctx.name);
  const sign = SIGN[lang];

  const bodies: Record<Lang, string> = {
    cs: `${hi}

ozýváme se ohledně termínu ${r} v apartmánu ANDE 1403, který pro vás stále držíme — do ${exp}.

Máte o termín ještě zájem? Pokud ano, pošlete nám prosím celé jméno, telefon a předpokládaný čas příjezdu. Po tomto datu termín uvolníme dalším zájemcům.

${sign}`,
    en: `${hi}

we are following up on the dates ${r} at ANDE 1403, which we are still holding for you until ${exp}.

Are you still interested? If so, please send us your full name, phone number and estimated time of arrival. After that date we will release the dates to other guests.

${sign}`,
    pl: `${hi}

przypominamy o terminie ${r} w apartamencie ANDE 1403, który nadal dla Państwa rezerwujemy — do ${exp}.

Czy termin jest nadal aktualny? Jeśli tak, prosimy o imię i nazwisko, numer telefonu oraz przewidywaną godzinę przyjazdu. Po tej dacie zwolnimy termin dla innych gości.

${sign}`,
    ru: `${hi}

напоминаем о датах ${r} в апартаменте ANDE 1403 — мы держим их для вас до ${exp}.

Вы всё ещё заинтересованы? Если да, пришлите, пожалуйста, имя и фамилию, номер телефона и предполагаемое время приезда. После этой даты мы освободим даты для других гостей.

${sign}`,
    ka: `${hi}

გახსენებთ თარიღებს ${r} ბინაში ANDE 1403 — ისინი თქვენთვის დაჯავშნილია ${exp}-მდე.

კვლავ დაინტერესებული ხართ? თუ კი, გამოგვიგზავნეთ სახელი და გვარი, ტელეფონის ნომერი და ჩამოსვლის სავარაუდო დრო. ამ თარიღის შემდეგ ჯავშანს გავათავისუფლებთ.

${sign}`,
    he: `${hi}

אנחנו חוזרים אליכם בנוגע לתאריכים ${r} בדירה ANDE 1403, שאותם אנחנו עדיין שומרים עבורכם עד ${exp}.

האם התאריכים עדיין רלוונטיים? אם כן, אנא שלחו לנו שם מלא, מספר טלפון ושעת הגעה משוערת. לאחר מועד זה נשחרר את התאריכים.

${sign}`,
  };

  const subjects: Record<Lang, string> = {
    cs: `ANDE 1403 – ještě platí termín ${r}?`,
    en: `ANDE 1403 – are the dates ${r} still relevant?`,
    pl: `ANDE 1403 – czy termin ${r} jest aktualny?`,
    ru: `ANDE 1403 – даты ${r} ещё актуальны?`,
    ka: `ANDE 1403 – თარიღები ${r} კვლავ აქტუალურია?`,
    he: `ANDE 1403 – האם התאריכים ${r} עדיין רלוונטיים?`,
  };

  return { subject: subjects[lang], body: bodies[lang] };
}

/* ------------------------------------------------------- 3. potvrzení (automaticky) */

export function confirmation(lang: Lang, ctx: TplCtx): Mail {
  const r = range(lang, ctx);
  const hi = HELLO[lang](ctx.name);
  const sign = SIGN[lang];
  const people = ctx.guests ?? null;

  const guestLine: Record<Lang, string> = {
    cs: people ? `Počet osob: ${people}` : '',
    en: people ? `Number of guests: ${people}` : '',
    pl: people ? `Liczba osób: ${people}` : '',
    ru: people ? `Количество гостей: ${people}` : '',
    ka: people ? `სტუმრების რაოდენობა: ${people}` : '',
    he: people ? `מספר אורחים: ${people}` : '',
  };

  const bodies: Record<Lang, string> = {
    cs: `${hi}

děkujeme za doplnění údajů — rezervace je potvrzená.

Termín: ${r}
${guestLine.cs}

Blíž k příjezdu se vám ozveme s praktickými informacemi k převzetí apartmánu.

${sign}`,
    en: `${hi}

thank you for the details — your booking is confirmed.

Dates: ${r}
${guestLine.en}

Closer to your arrival we will send you the practical information for picking up the apartment.

${sign}`,
    pl: `${hi}

dziękujemy za uzupełnienie danych — rezerwacja jest potwierdzona.

Termin: ${r}
${guestLine.pl}

Bliżej terminu przyjazdu prześlemy Państwu praktyczne informacje dotyczące odbioru apartamentu.

${sign}`,
    ru: `${hi}

спасибо за данные — бронирование подтверждено.

Даты: ${r}
${guestLine.ru}

Ближе к приезду мы пришлём вам практическую информацию о заселении.

${sign}`,
    ka: `${hi}

გმადლობთ მონაცემებისთვის — ჯავშანი დადასტურებულია.

თარიღები: ${r}
${guestLine.ka}

ჩამოსვლამდე ცოტა ხნით ადრე გამოგიგზავნით პრაქტიკულ ინფორმაციას ბინის ჩაბარების შესახებ.

${sign}`,
    he: `${hi}

תודה על הפרטים — ההזמנה מאושרת.

תאריכים: ${r}
${guestLine.he}

לקראת ההגעה נשלח לכם מידע מעשי על קבלת הדירה.

${sign}`,
  };

  const subjects: Record<Lang, string> = {
    cs: `ANDE 1403 – rezervace potvrzena (${r})`,
    en: `ANDE 1403 – booking confirmed (${r})`,
    pl: `ANDE 1403 – rezerwacja potwierdzona (${r})`,
    ru: `ANDE 1403 – бронирование подтверждено (${r})`,
    ka: `ANDE 1403 – ჯავშანი დადასტურებულია (${r})`,
    he: `ANDE 1403 – ההזמנה אושרה (${r})`,
  };

  return { subject: subjects[lang], body: bodies[lang].replace(/\n\n\n+/g, '\n\n') };
}

/* -------------------------------------- 4. pokyny k odjezdu (den předem, automaticky) */

export function departure(lang: Lang, ctx: TplCtx): Mail {
  const hi = HELLO[lang](ctx.name);
  const sign = SIGN[lang];
  const d = formatDate(ctx.checkout, lang);

  const bodies: Record<Lang, string> = {
    cs: `${hi}

zítra (${d}) je den vašeho odjezdu. Prosíme, před odchodem:

• klíče nechte na recepci
• dálkový ovladač klimatizace vraťte na své místo do držáku na zdi
• dálkový ovladač televize a vstupní kartu nechte na poličce u routeru

Děkujeme, že jste u nás bydleli, a přejeme šťastnou cestu.

${sign}`,
    en: `${hi}

tomorrow (${d}) is your departure day. Before you leave, please:

• leave the keys at the reception desk
• return the air-conditioning remote to its holder on the wall
• leave the TV remote and the entry card on the shelf by the router

Thank you for staying with us and have a safe trip.

${sign}`,
    pl: `${hi}

jutro (${d}) jest dzień Państwa wyjazdu. Prosimy przed wyjściem:

• klucze zostawić w recepcji
• pilot do klimatyzacji odłożyć na swoje miejsce, do uchwytu na ścianie
• pilot do telewizora i kartę wejściową zostawić na półce przy routerze

Dziękujemy za pobyt i życzymy szczęśliwej podróży.

${sign}`,
    ru: `${hi}

завтра (${d}) день вашего отъезда. Пожалуйста, перед уходом:

• оставьте ключи на ресепшене
• верните пульт от кондиционера на место, в держатель на стене
• пульт от телевизора и входную карту оставьте на полочке возле роутера

Спасибо, что были нашими гостями, счастливого пути.

${sign}`,
    ka: `${hi}

ხვალ (${d}) თქვენი გამგზავრების დღეა. გთხოვთ, წასვლამდე:

• გასაღებები დატოვეთ რეცეფციაზე
• კონდიციონერის პულტი დააბრუნეთ თავის ადგილას, კედელზე დამაგრებულ სამაგრში
• ტელევიზორის პულტი და შესასვლელი ბარათი დატოვეთ როუტერთან თაროზე

გმადლობთ, რომ ჩვენთან იყავით, და გისურვებთ ბედნიერ მგზავრობას.

${sign}`,
    he: `${hi}

מחר (${d}) הוא יום העזיבה שלכם. לפני היציאה, נא:

• להשאיר את המפתחות בדלפק הקבלה
• להחזיר את השלט של המזגן למקומו, למתקן שעל הקיר
• להשאיר את השלט של הטלוויזיה ואת כרטיס הכניסה על המדף ליד הראוטר

תודה שהתארחתם אצלנו, ונסיעה טובה.

${sign}`,
  };

  const subjects: Record<Lang, string> = {
    cs: `ANDE 1403 – pokyny k odjezdu (${d})`,
    en: `ANDE 1403 – check-out instructions (${d})`,
    pl: `ANDE 1403 – informacje o wyjeździe (${d})`,
    ru: `ANDE 1403 – инструкции при отъезде (${d})`,
    ka: `ANDE 1403 – გამგზავრების ინსტრუქცია (${d})`,
    he: `ANDE 1403 – הנחיות לעזיבה (${d})`,
  };

  return { subject: subjects[lang], body: bodies[lang] };
}

/* ------------------------- 5. avízo na úklid (2 dny předem, česky, automaticky) */

export function cleaningNotice(ctx: TplCtx & { guestName: string; phone?: string | null }): Mail {
  const out = formatDate(ctx.checkout, 'cs');
  const next = ctx.nextCheckin
    ? `Další host přijíždí ${formatDate(ctx.nextCheckin, 'cs')} — úklid by měl být hotový do té doby.`
    : 'Další host zatím není potvrzený, úklid stačí do několika dní po odjezdu.';

  return {
    subject: `ANDE 1403 – úklid po hostovi (odjezd ${out})`,
    body: `Ahoj,

host ${ctx.guestName} odjíždí ${out} (pobyt ${formatDate(ctx.checkin, 'cs')} – ${out}${
      ctx.guests ? `, ${ctx.guests} osob` : ''
    }). Je potřeba zajistit úklid apartmánu.

${next}

Návrh, co je potřeba:
• výměna ložního prádla a ručníků
• koupelna a WC
• kuchyňská linka, lednice (vyklidit zbytky jídla), nádobí
• vysátí a vytření podlah
• vynést odpadky
• kontrola, jestli host nenechal osobní věci a jestli jsou na místě oba dálkové ovladače a vstupní karta
• zkontrolovat, že je vše funkční (klimatizace, světla, voda) — případné závady dej vědět

Díky,
automatická zpráva systému ANDE 1403`,
  };
}

/* --------------------------------------- 6. žádost o schválení pro Jakuba (česky) */

export function approvalRequest(args: {
  kind: string;
  guestEmail: string;
  guestName: string | null;
  lang: Lang;
  dates: string;
  summary: string;
  original: string;
  proposed: { subject: string; body: string };
  approveUrl: string;
  rejectUrl: string;
  dryRun: boolean;
}): Mail {
  const kindLabel = args.kind === 'first_reply' ? 'první odpověď na novou poptávku' : 'vyjednávací odpověď';
  return {
    subject: `[ANDE schválení] ${kindLabel} – ${args.guestName ?? args.guestEmail} (${args.dates})`,
    body: `Čeká na tvoje schválení: ${kindLabel}.

Host:    ${args.guestName ?? '(jméno neuvedeno)'} <${args.guestEmail}>
Termín:  ${args.dates}
Jazyk:   ${args.lang}
Shrnutí: ${args.summary}
${args.dryRun ? '\n⚠️  Systém běží v režimu DRY_RUN — i po schválení se e-mail hostovi NEODEŠLE, jen zaloguje.\n' : ''}
— — — původní zpráva hosta — — —
${args.original.slice(0, 1500)}

— — — návrh odpovědi — — —
Předmět: ${args.proposed.subject}

${args.proposed.body}

— — —
SCHVÁLIT (odešle se hostovi):
${args.approveUrl}

ZAMÍTNOUT (nic se neodešle, vyřídíš ručně):
${args.rejectUrl}

Odkaz otevře stránku s potvrzovacím tlačítkem — samotné kliknutí na odkaz nic neodešle.`,
  };
}
