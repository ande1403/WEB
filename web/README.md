# Web ANDE · Batumi — kostra

Statický web apartmánu. Žádný backend, žádné buildy — čisté HTML/CSS/JS.

## Struktura

```
web/
├── index.html          jazykový rozcestník
├── assets/
│   ├── css/style.css   sdílený styl (světlý, prémiový, RTL-ready)
│   └── js/main.js      mobilní menu + brána pro hosty
├── cs/ pl/ ru/ ka/ he/ jazykové verze, v každé:
│   ├── index.html      úvod
│   ├── gallery.html    galerie — 16 reálných fotek apartmánu a domu
│   ├── tips.html       okolí a tipy — editoriální styl, 17 bohatých karet (highlighty)
│   │                   + 102 kompaktních řádků, generováno z tools/generate_places.py
│   ├── contact.html    kontakt
│   └── guests.html     chráněná sekce pro hosty
```

Hebrejská verze (`he/`) je plně RTL. Stejný název souboru = stejná stránka ve všech jazycích (přepínač jazyků jen mění složku).

## Sekce pro hosty a heslo

Aktuální heslo: **Batumi2026** (v kódu je jen jeho SHA-256 otisk).

Změna hesla: v terminálu spusť `echo -n "NoveHeslo" | shasum -a 256` a výsledný otisk vlož do `assets/js/main.js` (konstanta `GUEST_HASH`).

**Důležité:** jde o lehkou ochranu — obsah je v HTML a technicky zdatný člověk ho najde ve zdrojovém kódu. Pro fázi kostry (samé placeholdery) to stačí. **Než doplníš skutečné údaje (Wi-Fi heslo apod.), přepneme na Cloudflare Access nebo StatiCrypt** — připomeň mi to, zařídím.

## Lokální prohlížení

Stačí otevřít `index.html` v prohlížeči (dvojklik).

## Nasazení (doporučeno: Cloudflare Pages)

1. Založ účet na pages.cloudflare.com (zdarma).
2. Nahraj složku `web/` (drag & drop v „Direct Upload", nebo přes Git).
3. Web poběží na `neco.pages.dev`; vlastní doménu lze připojit v nastavení.

Alternativa: Netlify Drop (app.netlify.com/drop) — přetáhneš složku a hotovo.

## Doplňování obsahu

- Fotky: dej mi je, převedu do WebP a nasadím do galerie i úvodu.
- Skřínky, návody, Wi-Fi, kontakty: pošli seznamy, doplním do všech 5 jazyků.
- Nové tipy: stačí říct název místa a pár slov, přidám kartu s navigací.
- Místa označená „doplníme" v textech = čeká na obsah.

## Stránka "Okolí a tipy" — jak funguje

Generuje ji `tools/generate_places.py` (spouštěj `python3 tools/generate_places.py` z kořene
projektu). Skript čte export Google Maps (`export google/...csv`) a přepíše jen blok
`PLACES:START..END` v každé jazykové verzi — zbytek stránky nechá být.

Dvě úrovně obsahu:
- **17 "highlight" karet** (hlavní památky, výlety, pláže, zoo, cirkus) — rozbalovací karta
  s fotkou, fakty (otevírací doba, cena, doba návštěvy — ověřeno webem), barevnými tipy
  a odkazem do map. Definované v `HIGHLIGHTS` na začátku skriptu.
- **Zbylá místa** (kavárny, obchody, služby...) — kompaktní klikací řádek do mapy.
  Definované v `PLACES` / `CURATED`.

Nad tímto generovaným blokem je ještě ručně vložená sekce **"Hned za rohem"**
(blok `NEARBY:START..END`, hned za úvodní fotkou moře) — bezprostřední okolí domu:
samoobsluha 24/7 v přízemí, supermarket Nikora, lékárna a drogerie, Mandarin Shawerma
a Trattoria Zio přes ulici, Beer House u parku, Nový bulvár a park (dětské hřiště,
venkovní posilovna) a autobusová zastávka — ověřené na Google Mapách. Skript
`generate_places.py` tento blok nepřepisuje, je mimo rozsah jeho regexu — uprav ho
ručně přímo v `tips.html` v každém jazyce.

### Fotky u highlightů

14 ze 17 highlightů má reálnou fotku (`web/assets/img/places/*.webp`) dohledanou na
Wikimedia Commons — vždy jen s licencí CC BY / CC BY-SA (nikdy fair-use ani bez licence).
Foto i odkaz na zdroj/autora se zobrazí přímo v rozbalené kartě (`credit`/`credit_url`
u příslušné položky v `HIGHLIGHTS`). 3 highlighty fotku nemají záměrně — **Gomis Mta
Viewpoint**, **Batumi City Zoo** a **STAR Circus Georgia** — protože se pro ně nepodařilo
najít odpovídající volně licencovanou fotku (jen špatná lokace nebo irelevantní materiál),
a raději zůstal placeholder než zavádějící obrázek.

Pozn. ke dvěma highlightům (věž gruzínské abecedy, socha Ali & Nino): Gruzie nemá
tzv. "freedom of panorama" pro autorská architektonická/umělecká díla, Wikimedia Commons
proto u těchto kategorií upozorňuje na hraniční status. Fotky mají platnou CC licenci
a jsou použity informativně na neveřejném rodinném webu s uvedením autora — je to vědomé
rozhodnutí, ne přehlédnutí.

Doplnění dalších fotek (chybějící 3 highlighty): pošli mi odkaz nebo fotku a doplním.

## Galerie apartmánu

`web/{lang}/gallery.html` má 16 reálných fotek (`web/assets/img/*.webp`, dvě velikosti
800/1600 přes `srcset`), seřazených podle logiky prohlídky: vchod se psem → vestibul →
pohled na byt → sedačka (rozkládací) → jídelní kout → kávovar → prostřený stůl → kuchyň →
ložnice → komoda/psací stůl → koupelna → sprcha → WC → výhled na moře z balkonu → západ
slunce → hero foto. Text u galerie i karta "Vybavení" na úvodní stránce zmiňují, že
pohovka v obýváku je rozkládací (+2 plnohodnotná spací místa) a byt má multisplit
klimatizaci s nastavením teploty po místnostech. Nahrané fotky se zpracovávají ručně
(oříznutí, převod do WebP) — pošli další a doplním stejným způsobem.

## TODO před ostrým provozem

- [ ] fotky u zbylých 3 highlight karet (Gomis Mta, zoo, cirkus) — zatím žádná vhodná nenalezena
- [ ] kontakty (telefon, e-mail, WhatsApp)
- [ ] obsah skřínek a návody
- [ ] Wi-Fi a praktické info
- [ ] vlastní doména
- [ ] silnější ochrana sekce pro hosty (Cloudflare Access / StatiCrypt)
- [ ] favicon a OG obrázek pro sdílení
