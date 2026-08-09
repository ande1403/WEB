# Master prompt — Web apartmánu Batumi

> Tento text vlož jako zadání, až budeme stavět web (nebo jeho část). Sekce označené TODO doplň, až budeš vědět víc.

---

Postav kostru webu pro náš prémiový apartmán v Batumi (Gruzie). Web slouží hostům, kteří k nám jedou na doporučení — známí a známí známých. Nejde o komerční prezentaci pro Booking, ale o vizitku bytu a praktického průvodce pro hosty.

## Technologie a kvalita
- Čistý statický web: HTML + CSS + minimum JS, žádná databáze, žádné CMS, žádné externí frameworky. Jeden repozitář, přehledná struktura souborů.
- Cíl: bezpečný (žádný backend = minimální útočná plocha), bytelný (funguje i bez JS), rychlý (Lighthouse 95+, optimalizované obrázky ve WebP, lazy-loading).
- Responzivní mobile-first — hosté ho budou otevírat hlavně na telefonu.
- Připravený pro nasazení na Cloudflare Pages (doporučený hosting: zdarma, rychlé CDN i pro hosty z Izraele, Polska a Gruzie).

## Jazyky
Pět jazykových verzí: čeština (výchozí), polština, ruština, gruzínština, hebrejština.
- Struktura URL: `/cs/`, `/pl/`, `/ru/`, `/ka/`, `/he/`.
- Hebrejská verze plně RTL (`dir="rtl"`, zrcadlené rozložení).
- Přepínač jazyků viditelný na každé stránce, správné `hreflang` a `lang` atributy.
- Texty drž v oddělených souborech / jasně oddělených blocích, ať se překlady snadno udržují.

## Struktura webu

**Veřejná část:**
1. **Úvod** — atmosférická prezentace bytu: velké fotky, poloha, charakter, pro koho je. Bez citlivých detailů.
2. **Galerie** — fotogalerie interiéru a výhledů.
3. **Okolí a tipy** — výlety po okolí, restaurace a kavárny, nákupy, pláže, co vidět. Každý tip s odkazem „Navigovat" do Google Maps (odkaz `https://maps.google.com/?q=...` funguje bez API klíče). Volitelně vložená mapa s piny.
4. **Kontakt** — jak se s námi spojit. TODO: jaké kontakty uvést.

**Sekce pro hosty (chráněná heslem):**
5. **Průvodce bytem** — co je v které skřínce a zásuvce, systematicky po místnostech.
6. **Návody** — obsluha spotřebičů a zařízení (klimatizace, pračka, TV, bojler…), stručně, s ikonami.
7. **Praktické info** — Wi-Fi, check-in/check-out, odpad, nouzové kontakty, domovní pravidla. TODO: doplnit konkrétní údaje.

Ochrana sekce pro hosty: na statickém webu buď Cloudflare Access (kód na e-mail), nebo StatiCrypt (stránka zašifrovaná heslem přímo v HTML — hostům stačí poslat jedno heslo). Vyber a implementuj jednodušší variantu, heslo nesmí být v kódu v čitelné podobě.

## Design
- Moderní, trendy, prémiový. Světlý a vzdušný styl butikového hotelu: hodně bílého prostoru, velkorysé fotky, jemná paleta (teplá neutrální + jeden akcent — např. mořská modrozelená odkazující na Černé moře), kvalitní typografie s podporou latinky, cyrilice, gruzínského písma i hebrejštiny (např. Noto Sans / Noto Serif rodina).
- Žádné šablonovité prvky, žádný vizuální šum. Působí osobně, ne jako realitní inzerát.
- Dokud nejsou fotky, použij elegantní placeholdery se správnými poměry stran.

## Co zatím nevím (doplním později)
- TODO: název/doména webu
- TODO: fotky bytu
- TODO: přesná adresa a poloha pro mapy
- TODO: konkrétní obsah skřínek, návody, Wi-Fi údaje
- TODO: seznam tipů na výlety a podniky

Kostru postav tak, aby šlo obsah snadno doplňovat po částech — každá sekce ať funguje i s ukázkovým obsahem.
