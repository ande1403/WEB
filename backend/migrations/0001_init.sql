-- ANDE 1403 backend — inicializační schéma (D1 / SQLite)
-- Všechna data jsou textová ISO: datum = 'YYYY-MM-DD', čas = ISO 8601 UTC.
-- Konvence: checkin i checkout jsou INCLUSIVE dny (host je přítomen i v den checkoutu).
-- Převod na Google Calendar all-day end.date (exclusive) dělá kód, ne databáze.

CREATE TABLE IF NOT EXISTS reservations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_name             TEXT,
  guest_email            TEXT NOT NULL,
  guest_phone            TEXT,
  guests_count           INTEGER,
  lang                   TEXT NOT NULL DEFAULT 'cs',
  checkin                TEXT NOT NULL,
  checkout               TEXT NOT NULL,
  arrival_time           TEXT,
  status                 TEXT NOT NULL,          -- provisional | confirmed | cancelled | expired
  hold_expires_at        TEXT,
  followup_sent_at       TEXT,
  calendar_event_id      TEXT,
  cleaning_event_id      TEXT,
  departure_email_sent_at TEXT,
  cleaning_email_sent_at TEXT,
  source                 TEXT,                   -- web-form | email | manual
  thread_id              TEXT,
  note                   TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_res_status   ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_res_email    ON reservations(guest_email);
CREATE INDEX IF NOT EXISTS idx_res_checkout ON reservations(checkout);

-- Idempotence: každá Gmail zpráva se zpracuje právě jednou, i když cron poběží dvakrát
-- nebo se dohání vynechaná mezera.
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id     TEXT PRIMARY KEY,
  thread_id      TEXT,
  from_email     TEXT,
  subject        TEXT,
  internal_date  TEXT,
  processed_at   TEXT NOT NULL,
  kind           TEXT,
  reservation_id INTEGER,
  summary        TEXT
);

-- Fronta věcí čekajících na lidské schválení (první odpověď na poptávku, vyjednávání).
CREATE TABLE IF NOT EXISTS approvals (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL,
  status         TEXT NOT NULL,   -- pending | approved | rejected | sent | expired | failed
  kind           TEXT NOT NULL,   -- first_reply | negotiation
  reservation_id INTEGER,
  to_email       TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  lang           TEXT,
  thread_id      TEXT,
  in_reply_to    TEXT,
  context        TEXT,            -- JSON: úryvek původní zprávy + co model rozpoznal
  decided_at     TEXT,
  result         TEXT
);

CREATE INDEX IF NOT EXISTS idx_appr_status ON approvals(status);

-- Log všeho, co odešlo ven (nebo by odešlo, kdyby nebyl DRY_RUN).
CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  dry_run    INTEGER NOT NULL,
  channel    TEXT NOT NULL,       -- gmail | calendar
  action     TEXT NOT NULL,
  ref        TEXT,
  payload    TEXT NOT NULL,
  result     TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox(created_at);

-- Log běhů cronu (obdoba .secrets/ande-inbox-check-log.md).
CREATE TABLE IF NOT EXISTS job_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  ok            INTEGER,
  trigger       TEXT,
  messages_seen INTEGER,
  actions       TEXT,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_joblog_started ON job_log(started_at);
