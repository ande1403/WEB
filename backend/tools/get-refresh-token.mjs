#!/usr/bin/env node
/**
 * Jednorázové získání Google refresh tokenu pro účet ande1403.batumi@gmail.com.
 *
 * Spustit NA SVÉM POČÍTAČI (ne v cloudu), protože potřebuje otevřít prohlížeč:
 *
 *   cd backend
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node tools/get-refresh-token.mjs
 *
 * Skript pustí lokální server na http://localhost:8123, vypíše URL k přihlášení,
 * ty se přihlásíš JAKO ande1403.batumi@gmail.com, potvrdíš oprávnění a skript
 * vypíše refresh token. Ten pak vlož přes:
 *
 *   npx wrangler secret put GOOGLE_REFRESH_TOKEN
 *
 * Token nikam neukládám — jen ho vypíšu do terminálu.
 */

import http from 'node:http';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = Number(process.env.PORT || 8123);
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Chybí GOOGLE_CLIENT_ID nebo GOOGLE_CLIENT_SECRET v prostředí.');
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // vynutí vydání refresh tokenu i při opakovaném souhlasu
  });

console.log('\n1) Otevři tuhle adresu v prohlížeči a přihlas se jako ande1403.batumi@gmail.com:\n');
console.log(authUrl);
console.log('\n2) Potvrď oprávnění. Pak se sem token vypíše sám.\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end('not found');
    return;
  }
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error || !code) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(`Chyba: ${error ?? 'chybí code'}`);
    server.close();
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const data = await tokenRes.json();

  if (!tokenRes.ok || !data.refresh_token) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Nepovedlo se, koukni do terminálu.');
    console.error('\nOdpověď Google:', JSON.stringify(data, null, 2));
    console.error(
      '\nPokud chybí refresh_token, Google ho už jednou vydal. Zruš přístup aplikace na\n' +
        'https://myaccount.google.com/permissions a spusť skript znovu.'
    );
    server.close();
    process.exit(1);
  }

  res
    .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    .end('<h1>Hotovo</h1><p>Refresh token je vypsaný v terminálu. Tuhle stránku můžeš zavřít.</p>');

  console.log('\n================ REFRESH TOKEN ================\n');
  console.log(data.refresh_token);
  console.log('\n==============================================');
  console.log('\nVlož ho příkazem:  npx wrangler secret put GOOGLE_REFRESH_TOKEN\n');
  console.log('Rozsahy v tokenu:', data.scope);
  server.close();
});

server.listen(PORT);
