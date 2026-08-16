import type { Env } from '../types';

/**
 * Kontrola konfigurace před každým během.
 *
 * OWNER_EMAIL a CLEANING_EMAILS jsou secrets (repo je veřejné, osobní adresy do něj nepatří),
 * takže se na ně nedá spolehnout jako na hodnoty z wrangler.jsonc — po nasazení na nový účet
 * nebo po smazání secretu by prostě chyběly. Bez téhle kontroly by se e-mail pokusil odejít
 * na adresu "undefined" a chyba by se projevila až v Gmail API, uprostřed rozdělané práce.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requiredSecrets(env: Env): string[] {
  const missing: string[] = [];
  if (!env.OWNER_EMAIL?.trim()) missing.push('OWNER_EMAIL');
  if (!env.CLEANING_EMAILS?.trim()) missing.push('CLEANING_EMAILS');
  if (!env.APPROVAL_SECRET?.trim()) missing.push('APPROVAL_SECRET');
  if (!env.GOOGLE_CLIENT_ID?.trim()) missing.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) missing.push('GOOGLE_CLIENT_SECRET');
  if (!env.GOOGLE_REFRESH_TOKEN?.trim()) missing.push('GOOGLE_REFRESH_TOKEN');
  return missing;
}

export function assertConfig(env: Env): void {
  const missing = requiredSecrets(env);
  if (missing.length) {
    throw new Error(
      `Chybí secrets: ${missing.join(', ')}. Nastav je přes \`npx wrangler secret put <NÁZEV>\` ` +
        '(viz seznam na konci backend/wrangler.jsonc).'
    );
  }
  if (!EMAIL_RE.test(env.OWNER_EMAIL.trim())) {
    throw new Error(`OWNER_EMAIL nevypadá jako e-mailová adresa: ${env.OWNER_EMAIL}`);
  }
  if (!cleaningRecipients(env).length) {
    throw new Error(`CLEANING_EMAILS neobsahuje žádnou platnou adresu: ${env.CLEANING_EMAILS}`);
  }
}

/** Adresy pro avízo na úklid — rozsekané, ořezané a ověřené. */
export function cleaningRecipients(env: Env): string[] {
  return (env.CLEANING_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => EMAIL_RE.test(s));
}
