# ANDE 1403 — backend pro automatizaci rezervací

Cloudflare Worker s Cron Triggerem, který nahrazuje ruční/poloautomatický provoz přes Claude Cowork.
Běží nezávisle na tom, jestli je zapnutý počítač nebo Claude.

**Tenhle Worker není web.** Web ANDE 1403 je samostatný Worker `ande1403`, konfigurovaný
v `../wrangler.jsonc`, a tenhle adresář se ho nedotýká. Nasazují se odděleně.

---

## Co systém dělá

Každých 30 minut přečte schránku `ande1403.batumi@gmail.com`, každou novou zprávu klasifikuje
a podle toho jedná.

| Situace | Co systém udělá | Schválení? |
|---|---|---|
| Nová poptávka, termín volný | Založí provizorní hold v kalendáři (5 dní) + připraví odpověď | **ANO** — návrh jde e-mailem Jakubovi |
| Nová poptávka, termín obsazený | Neudělá nic, pošle Jakubovi info o kolizi a nejbližší volný termín | — (nic neodchází hostovi) |
| Nová poptávka bez jasného termínu | Neudělá nic, pošle Jakubovi původní zprávu | — |
| Host doplní jméno + telefon + čas příjezdu | Potvrdí rezervaci, přejmenuje událost, založí úklidový blok, pošle potvrzení | ne, automaticky |
| Host smlouvá (cena, sleva, změna termínu) | Připraví návrh odpovědi | **ANO** |
| Host ruší | Neudělá nic, upozorní Jakuba | — |
| 2 dny před vypršením holdu | Pošle hostovi dohledávku | ne, automaticky |
| Hold vypršel | Uvolní termín, smaže událost, upozorní Jakuba | ne, automaticky |
| 2 dny před odjezdem | Pošle avízo na úklid na adresy ze secretu `CLEANING_EMAILS` | ne, automaticky |
| 1 den před odjezdem | Pošle hostovi pokyny k odjezdu v jeho jazyce | ne, automaticky |

Pevné pravidlo: **první odpověď na novou poptávku a jakákoliv vyjednávací odpověď nikdy neodejde
bez lidského schválení.** Všechno ostatní jde automaticky.

### Konvence, na kterých to stojí

- **`checkin` / `checkout` v databázi jsou inclusive** — host je v den checkoutu ještě přítomen.
  Do Google Calendaru se konec zapisuje jako `checkout + 1` (all-day `end.date` je exclusive),
  jinak by se den odjezdu v kalendáři ukazoval jako volný.
- **Úklidová rezerva = 3 dny** (den odjezdu + 2 další). Zapisuje se jako vlastní událost
  „ÚKLID – po [host]" s `colorId: 6` (oranžová). Další host může nejdřív `checkout + 3`.
  Kontrola dostupnosti tuhle mezeru zahrnuje na obou stranách.
- **Idempotence** — každé zpracované Gmail message ID je v tabulce `processed_messages`.
  Dvojí běh cronu ani dohnání vynechané mezery nepošle hostovi nic dvakrát.
  Zpráva, u které dojde k chybě, se jako zpracovaná **neoznačí** a příští běh ji zkusí znovu.
- **Časové úlohy se dohánějí** — podmínky jsou psané jako „ještě neodesláno A den už nastal",
  ne „přesně dnes". Výpadek cronu tedy pošle e-mail pozdě, ne nikdy.

---

## Struktura

```
backend/
  wrangler.jsonc          konfigurace Workeru (cron, D1, vars) — secrets tu NEJSOU
  migrations/0001_init.sql schéma D1
  src/
    index.ts              scheduled() + fetch() (schvalovací odkazy, /status, /run)
    gateway.ts            JEDINÉ místo, kudy jde zápis ven; respektuje DRY_RUN, loguje do outbox
    types.ts              typy + Env
    ui.ts                 HTML stránky (schválení, přehled)
    google/auth.ts        OAuth refresh-token flow
    google/gmail.ts       čtení a odesílání pošty
    google/calendar.ts    kalendář (all-day události)
    ai/classify.ts        OpenAI klasifikace + heuristický fallback
    storage/db.ts         dotazy nad D1
    util/                 datumy, MIME, HMAC, parsování textu
    workflow/
      inbound.ts          zpracování jedné příchozí zprávy
      daily.ts            časové úlohy
      approvals.ts        fronta schvalování
      availability.ts     kontrola dostupnosti včetně úklidové rezervy
      templates.ts        texty e-mailů v 6 jazycích
  test/                   33 testů, běží bez sítě (Gmail/Calendar/OpenAI jsou mockované)
  tools/get-refresh-token.mjs  jednorázové získání Google refresh tokenu
```

### Vývoj

```bash
cd backend
npm install
npm test          # 33 testů, žádná síť, žádné credentials
npm run typecheck
npm run dryrun    # wrangler build bez nasazení
```

---

## Co musíš udělat ručně, než to poběží naostro

Nic z toho za tebe nejde udělat — všechno vyžaduje přihlášení nebo souhlas v prohlížeči.

### 1. Google Cloud — OAuth klient

1. <https://console.cloud.google.com/> → přihlas se **jako ande1403.batumi@gmail.com** → nový projekt (např. `ande1403-backend`).
2. **APIs & Services → Library** → zapni **Gmail API** a **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → User type **External**, vyplň název a kontaktní e-mail.
4. Scopes: přidej `gmail.modify`, `gmail.send`, `calendar`.
5. **Audience → Test users**: přidej `ande1403.batumi@gmail.com`.
6. ⚠️ **Publishing status přepni na „In production"** (tlačítko *Publish app*).
   V režimu *Testing* Google vydává refresh tokeny s platností **7 dní** — musel bys token
   obnovovat každý týden. Ověření od Google (verification) pro tohle potřeba není, jen se při
   přihlášení jednou proklikáš varováním „Google hasn't verified this app" → *Advanced* → *Go to…*.
7. **Credentials → Create credentials → OAuth client ID** → typ **Web application**,
   Authorized redirect URI: `http://localhost:8123/oauth2callback`.
   Ulož si `client_id` a `client_secret`.

### 2. Refresh token

Na svém Macu (potřebuje prohlížeč):

```bash
cd backend
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node tools/get-refresh-token.mjs
```

Otevři vypsanou adresu, přihlas se **jako ande1403.batumi@gmail.com**, potvrď oprávnění.
Token se vypíše do terminálu. (Skript ho nikam neukládá.)

> Token přestane platit, když: změníš heslo účtu ande1403 (Gmail scope), odvoláš přístup aplikace,
> nebo se 6 měsíců nepoužije. Pak se celý krok 2 zopakuje. V logu to poznáš podle `invalid_grant`.

### 3. Kalendář — právo zápisu

OAuth token patří účtu `ande1403.batumi@gmail.com`, což je vlastník kalendáře „ANDE 1403 rezervace",
takže zápis funguje rovnou. Ověř jen, že v Nastavení kalendáře zůstalo veřejné sdílení
**jen volno/obsazeno** (kvůli embedu na webu) — na zápis přes API to nemá vliv.

### 4. Cloudflare — databáze, secrets, nasazení

```bash
cd backend
npx wrangler login

npx wrangler d1 create ande1403
#   → vypíše database_id; vlož ho do wrangler.jsonc místo PLACEHOLDER_DATABASE_ID

npm run db:init:remote      # vytvoří tabulky

npx wrangler secret put OWNER_EMAIL          # tvoje adresa pro schvalování a hlášení
npx wrangler secret put CLEANING_EMAILS      # adresy na úklid, oddělené čárkou bez mezer
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APPROVAL_SECRET     # cokoliv náhodného, např. `openssl rand -hex 32`

npm run deploy
```

> **Proč jsou osobní adresy secrets, a ne obyčejné `vars`:** repo `ande1403/WEB` je veřejné, takže
> všechno ve `wrangler.jsonc` vidí kdokoliv. `OWNER_EMAIL` a `CLEANING_EMAILS` jsou proto secrets.
> `MAILBOX_EMAIL` a `CALENDAR_ID` ve `vars` zůstaly schválně — kontaktní adresa je uvedená na webu
> a ID kalendáře je v embedu na `contact.html`, kde ukazuje jen volno/obsazeno.
> Když secret chybí, Worker běh rovnou odmítne s výpisem, co chybí — nezkusí poslat e-mail „nikam".
> Rychlá kontrola: `curl https://…workers.dev/health` vypíše `missing: []`, když je vše nastavené.

Po prvním nasazení wrangler vypíše adresu Workeru (`https://ande1403-backend.<účet>.workers.dev`).
**Vlož ji do `wrangler.jsonc` jako `PUBLIC_BASE_URL` a nasaď znovu** — jinak by schvalovací odkazy
v e-mailech vedly na neexistující adresu.

### 5. Kontrola v bezpečném režimu

`DRY_RUN` je po nasazení `"1"`. Worker v tomhle stavu **nic neodešle a nic nezapíše do kalendáře**,
jen spočítá, co by udělal, a zaloguje to.

1. Přehled: otevři `https://…workers.dev/status?token=<TOKEN>`.
   Token si vygeneruj HMAC-SHA256 z řetězce `status` klíčem `APPROVAL_SECRET`:
   ```bash
   printf 'status' | openssl dgst -sha256 -hmac "$APPROVAL_SECRET" -binary \
     | base64 | tr '+/' '-_' | tr -d '='
   ```
2. Ruční spuštění cyklu: `https://…workers.dev/run?token=<TOKEN>` → tlačítko *Spustit teď*.
3. Pošli si přes formulář na webu testovací poptávku a spusť `/run` znovu.
   Ve `/status` musí přibýt řádek v Rezervacích a dva řádky v Outboxu
   (vytvoření události + žádost o schválení), oba s `dry_run = 1`.
4. Zkontroluj v Outboxu texty — hlavně že sedí termín a jazyk.

### 6. Ostrý provoz

1. Ve `wrangler.jsonc` změň `"DRY_RUN": "1"` na `"0"`, `npm run deploy`.
2. **Vypni starý Cowork scheduled task `ande1403-inbox-check`** — jinak by na tutéž zprávu
   reagovaly dva systémy a host by dostal dvě odpovědi.
3. Pošli si jednu skutečnou testovací poptávku z webu a projdi celý tok
   (schvalovací e-mail → schválit → odpověď dorazí → odpověz s údaji → potvrzení + úklidový blok).
4. Po testu smaž testovací události z kalendáře a řádek z databáze:
   `npx wrangler d1 execute ande1403 --remote --command "DELETE FROM reservations WHERE id = X"`.

---

## Provoz

- **Přehled** — `/status?token=…`: rezervace, fronta schvalování, posledních 10 běhů, outbox.
- **Logy** — `npx wrangler tail ande1403-backend`, nebo v dashboardu (observability je zapnutá).
- **Vypnout automatiku** — nejrychleji `"DRY_RUN": "1"` + deploy. Cron poběží, ale nic neodejde.
- **Hlídání, že systém vůbec běží** — nejhorší porucha je tichá: vyprší Google token nebo se
  rozbije cron a nic nechodí, což zvenčí vypadá stejně jako „nikdo nepsal". Proto je volitelný
  secret `HEALTHCHECK_URL`: po každém úspěšném běhu se na tu adresu pošle GET. Založ si zdarma
  check na <https://healthchecks.io> (perioda 1 h), vlož jeho ping URL
  (`npx wrangler secret put HEALTHCHECK_URL`) a při výpadku ti přijde e-mail.
- **Změna textů e-mailů** — `src/workflow/templates.ts`, po úpravě `npm test` a deploy.
- **Změna modelu** — proměnná `OPENAI_MODEL` ve `wrangler.jsonc`.
  Bez `OPENAI_API_KEY` systém funguje dál na heuristice: poptávku z formuláře a datum ve tvaru
  `29.10.2026 - 3.11.2026` zvládne, volný text v cizím jazyce ne (takové zprávy pošle Jakubovi).

## Co zůstává otevřené

- **Gruzínské a hebrejské verze e-mailů nejsou ověřené rodilým mluvčím** (`templates.ts`, TODO
  v hlavičce souboru). Než přijde první host píšící gruzínsky nebo hebrejsky, projít.
- **Kontaktní formulář nemá pole pro termín a počet osob** — host to píše volným textem, což je
  jediné místo, kde se dá reálně splést datum. Doplnit do formuláře `date` inputy a `select`
  na počet osob by spolehlivost zvedlo víc než jakékoliv ladění promptu.
- **Ceny** systém nezná, takže o nich nikdy sám nepíše. Vyjednávací návrhy obsahují `[DOPLNIT]`.
- Přehledová tabulka `.secrets/ande-rezervace.md` je nahrazená tabulkou `reservations` v D1
  (`/status`). Pokud ji chceš dál vést i v souboru, musí se exportovat zvlášť.
