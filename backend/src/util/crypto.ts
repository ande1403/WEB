/** HMAC-SHA256 podpisy pro schvalovací odkazy + drobné pomůcky. */

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sign(secret: string, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload));
  return b64url(sig);
}

/** Ověření v konstantním čase (crypto.subtle.verify). */
export async function verify(secret: string, payload: string, signature: string): Promise<boolean> {
  const normalized = signature.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let raw: Uint8Array;
  try {
    const bin = atob(padded);
    raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await key(secret), raw, enc.encode(payload));
}

export function uuid(): string {
  return crypto.randomUUID();
}
