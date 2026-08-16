export interface Env {
  DB: D1Database;

  // vars (wrangler.jsonc)
  DRY_RUN: string;
  TIMEZONE: string;
  MAILBOX_EMAIL: string;
  CALENDAR_ID: string;
  HOLD_DAYS: string;
  FOLLOWUP_BEFORE_EXPIRY_DAYS: string;
  CLEANING_BLOCK_DAYS: string;
  OPENAI_MODEL: string;
  PUBLIC_BASE_URL: string;

  // secrets (wrangler secret put) — osobní adresy tu jsou schválně, repo je veřejné
  OWNER_EMAIL: string;
  CLEANING_EMAILS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  OPENAI_API_KEY?: string;
  APPROVAL_SECRET: string;
  /** Volitelné: URL, která se pingne po každém úspěšném běhu (dead man's switch). */
  HEALTHCHECK_URL?: string;
}

export type Lang = 'cs' | 'en' | 'pl' | 'ru' | 'ka' | 'he';
export const LANGS: Lang[] = ['cs', 'en', 'pl', 'ru', 'ka', 'he'];

export type ReservationStatus = 'provisional' | 'confirmed' | 'cancelled' | 'expired';

export interface Reservation {
  id: number;
  guest_name: string | null;
  guest_email: string;
  guest_phone: string | null;
  guests_count: number | null;
  lang: Lang;
  /** inclusive, YYYY-MM-DD */
  checkin: string;
  /** inclusive — host je v tento den ještě přítomen, YYYY-MM-DD */
  checkout: string;
  arrival_time: string | null;
  status: ReservationStatus;
  hold_expires_at: string | null;
  followup_sent_at: string | null;
  calendar_event_id: string | null;
  cleaning_event_id: string | null;
  departure_email_sent_at: string | null;
  cleaning_email_sent_at: string | null;
  source: string | null;
  thread_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type ApprovalKind = 'first_reply' | 'negotiation';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'sent' | 'expired' | 'failed';

export interface Approval {
  id: string;
  created_at: string;
  status: ApprovalStatus;
  kind: ApprovalKind;
  reservation_id: number | null;
  to_email: string;
  subject: string;
  body: string;
  lang: Lang | null;
  thread_id: string | null;
  in_reply_to: string | null;
  context: string | null;
  decided_at: string | null;
  result: string | null;
}

/** Minimální podoba e-mailu, se kterou pracuje workflow (nezávislá na Gmail API tvaru). */
export interface InboundMessage {
  id: string;
  threadId: string;
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  /** ISO 8601 */
  date: string;
  body: string;
  /** hodnota hlavičky Message-ID, pro In-Reply-To u odpovědi */
  messageIdHeader: string | null;
  labelIds: string[];
}

export type MessageKind =
  | 'new_inquiry'
  | 'guest_details'
  | 'negotiation'
  | 'cancellation'
  | 'other';

export interface Classification {
  kind: MessageKind;
  lang: Lang;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guests_count: number | null;
  /** YYYY-MM-DD, inclusive */
  checkin: string | null;
  /** YYYY-MM-DD, inclusive (den odjezdu) */
  checkout: string | null;
  arrival_time: string | null;
  summary: string;
  /** návrh textu odpovědi hostovi — použije se jen u kroků vyžadujících schválení */
  proposed_reply: string | null;
  confidence: number;
  source: 'ai' | 'heuristic';
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  cc?: string | null;
}
