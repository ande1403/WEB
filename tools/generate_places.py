#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generátor sekce 'Okolí a tipy' z exportu Google Maps (seznam Want to go).
V2 — editoriální styl (sticky pill navigace, barevně kódované kategorie
příroda/gastro/praktické, maplink řádky). Spuštění z kořene projektu:
    python3 tools/generate_places.py
Idempotentní — přepíše jen blok PLACES:START..END a doplní hlavičku/body
třídu, zbytek stránky nechá být."""
import csv, html, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSV = ROOT / "export google" / "google_maps_body_chci_navstivit.csv"
LANGS = ["cs", "pl", "ru", "ka", "he"]

NAV_LABEL = {"cs": "Navigovat", "pl": "Nawiguj", "ru": "Маршрут", "ka": "ნავიგაცია", "he": "ניווט"}
KIND_CSS = {"nature": "nature", "dine": "food", "daily": "practical"}
CAT_LABEL_KICKER = {"cs": "Kategorie", "pl": "Kategoria", "ru": "Категория", "ka": "კატეგორია", "he": "קטגוריה"}
COUNT_PREFIX = {"cs": "Celkem", "pl": "Łącznie", "ru": "Всего", "ka": "სულ", "he": "סה״כ"}

# (key, kind, {lang: label})
CATS = [
    ("sights",   "nature", {"cs": "Památky a město", "pl": "Zabytki i miasto", "ru": "Достопримечательности", "ka": "ღირსშესანიშნაობები", "he": "אתרים בעיר"}),
    ("trips",    "nature", {"cs": "Výlety a příroda", "pl": "Wycieczki i przyroda", "ru": "Экскурсии и природа", "ka": "გასეირნება და ბუნება", "he": "טיולים וטבע"}),
    ("beaches",  "nature", {"cs": "Pláže a rybaření", "pl": "Plaże i wędkowanie", "ru": "Пляжи и рыбалка", "ka": "პლაჟები და თევზაობა", "he": "חופים ודיג"}),
    ("georgian", "dine",   {"cs": "Gruzínská kuchyně", "pl": "Kuchnia gruzińska", "ru": "Грузинская кухня", "ka": "ქართული სამზარეულო", "he": "מטבח גאורגי"}),
    ("world",    "dine",   {"cs": "Světová kuchyně a jídelny", "pl": "Kuchnie świata i bary", "ru": "Мировая кухня и столовые", "ka": "მსოფლიო სამზარეულო", "he": "מטבח עולמי ומזנונים"}),
    ("cafes",    "dine",   {"cs": "Kavárny, pekárny a sladké", "pl": "Kawiarnie, piekarnie i słodycze", "ru": "Кафе, пекарни и сладкое", "ka": "კაფეები და საცხობები", "he": "בתי קפה ומאפיות"}),
    ("wine",     "dine",   {"cs": "Víno a pivo", "pl": "Wino i piwo", "ru": "Вино и пиво", "ka": "ღვინო და ლუდი", "he": "יין ובירה"}),
    ("food",     "daily",  {"cs": "Potraviny a trhy", "pl": "Spożywcze i targi", "ru": "Продукты и рынки", "ka": "სასურსათო და ბაზრები", "he": "מכולות ושווקים"}),
    ("shopping", "daily",  {"cs": "Nákupy a suvenýry", "pl": "Zakupy i pamiątki", "ru": "Покупки и сувениры", "ka": "საყიდლები და სუვენირები", "he": "קניות ומזכרות"}),
    ("kids",     "daily",  {"cs": "Pro děti", "pl": "Dla dzieci", "ru": "Детям", "ka": "ბავშვებისთვის", "he": "לילדים"}),
    ("services", "daily",  {"cs": "Služby a praktické", "pl": "Usługi i praktyczne", "ru": "Услуги", "ka": "სერვისები", "he": "שירותים"}),
]

def N(cs, pl, ru, ka, he):
    return {"cs": cs, "pl": pl, "ru": ru, "ka": ka, "he": he}

NOTE = {
    "pastry": N("cukrárna a dobrá káva", "cukiernia i dobra kawa", "кондитерская и кофе", "საკონდიტრო და ყავა", "קונדיטוריה וקפה טוב"),
    "souvenirs": N("suvenýry a dárky", "pamiątki i prezenty", "сувениры и подарки", "სუვენირები და საჩუქრები", "מזכרות ומתנות"),
    "shashlik": N("šašlik — gruzínské grilované maso", "szaszłyki z grilla", "шашлык", "მწვადი", "שישליק — בשר על האש"),
    "photo_spot": N("krásný interiér, skvělé místo na focení", "piękne wnętrze, świetne do zdjęć", "красивый интерьер, отличная фотозона", "ლამაზი ინტერიერი, კარგი ფოტოზონა", "עיצוב יפהפה, מושלם לתמונות"),
    "clothes_toys": N("oblečení a hračky", "odzież i zabawki", "одежда и игрушки", "ტანსაცმელი და სათამაშოები", "בגדים וצעצועים"),
    "dentist": N("ověřená zubní ordinace", "sprawdzony dentysta", "проверенный стоматолог", "სანდო სტომატოლოგი", "רופא שיניים מומלץ"),
    "kids_dentist": N("dětská zubní klinika", "dentysta dziecięcy", "детская стоматология", "ბავშვთა სტომატოლოგია", "רופא שיניים לילדים"),
    "khinkali": N("chinkali a gruzínská klasika", "chinkali i gruzińska klasyka", "хинкали и грузинская классика", "ხინკალი და ქართული კლასიკა", "חינקלי וקלאסיקה גאורגית"),
    "clothes": N("oblečení", "odzież", "одежда", "ტანსაცმელი", "בגדים"),
    "bags": N("tašky a kabelky", "torby i torebki", "сумки", "ჩანთები", "תיקים"),
    "grest": N("gruzínská restaurace", "restauracja gruzińska", "грузинский ресторан", "ქართული რესტორანი", "מסעדה גאורגית"),
    "rest": N("restaurace", "restauracja", "ресторан", "რესტორანი", "מסעדה"),
    "rest_prices": N("restaurace s příznivými cenami", "restauracja w dobrych cenach", "ресторан с приятными ценами", "რესტორანი კარგი ფასებით", "מסעדה במחירים טובים"),
    "khachapuri": N("adžarské chačapuri — místní specialita", "adżarskie chaczapuri — lokalny przysmak", "аджарские хачапури", "აჭარული ხაჭაპური", "חצ׳פורי אג׳רולי אמיתי"),
    "fishing_pier": N("rybářské molo", "molo wędkarskie", "рыбацкий пирс", "სათევზაო პირსი", "מזח דיג"),
    "thermal": N("termální sirný pramen", "termalne źródło siarkowe", "термальный серный источник", "თერმული გოგირდის წყარო", "מעיין גופרית תרמי"),
    "thermal_pool": N("termální jezírko", "termalne jeziorko", "термальное озерцо", "თერმული აუზი", "בריכה תרמית"),
    "groceries": N("potraviny", "sklep spożywczy", "продукты", "სასურსათო", "מכולת"),
    "our_shop": N("náš osvědčený obchod kousek od domu", "nasz sprawdzony sklep przy domu", "наш проверенный магазин рядом с домом", "ჩვენი სანდო მაღაზია სახლთან", "החנות הקבועה שלנו ליד הבית"),
    "supermarket": N("supermarket", "supermarket", "супермаркет", "სუპერმარკეტი", "סופרמרקט"),
    "ready_food": N("hotová jídla s sebou", "gotowe dania na wynos", "готовая еда навынос", "მზა კერძები", "אוכל מוכן לקחת"),
    "beer": N("místní pivovar", "lokalny browar", "местная пивоварня", "ადგილობრივი ლუდსახარში", "מבשלת בירה מקומית"),
    "beer_pub": N("bavorská pivnice", "bawarski pub piwny", "баварский пивной паб", "ბავარიული ლუდის ბარი", "פאב בירה בווארי"),
    "buffet": N("švédský stůl — rychle a levně", "bufet — szybko i tanio", "шведский стол — быстро и недорого", "შვედური მაგიდა — სწრაფად და იაფად", "מזנון חופשי — מהיר וזול"),
    "canteen": N("jídelna — poctivé jídlo za dobré ceny", "bar — uczciwe jedzenie w dobrej cenie", "столовая — вкусно и недорого", "სასადილო — გემრიელი და იაფი", "אוכל ביתי במחיר טוב"),
    "clouds": N("vyhlídka nad oblaky — za dobrého počasí neskutečné výhledy", "punkt widokowy nad chmurami — niesamowite widoki", "смотровая площадка над облаками — нереальные виды", "ხედი ღრუბლებს ზემოთ", "תצפית מעל העננים — נוף מדהים"),
    "dendro": N("rozlehlý dendrologický park u moře", "rozległy park dendrologiczny nad morzem", "огромный дендропарк у моря", "დიდი დენდროპარკი ზღვასთან", "פארק בוטני ענק ליד הים"),
    "dendro_free": N("dendropark se zvířaty — vstup zdarma", "park ze zwierzętami — wstęp bezpłatny", "дендропарк с животными — вход бесплатный", "დენდროპარკი ცხოველებით — უფასოა", "פארק עם בעלי חיים — כניסה חינם"),
    "boat": N("vyhlídkové plavby a turistická zóna", "rejsy widokowe", "прогулки на катере", "სანაოსნო გასეირნება", "שייט תיירותי"),
    "confluence": N("soutok dvou řek", "zbieg dwóch rzek", "слияние двух рек", "ორი მდინარის შესართავი", "מפגש שני נהרות"),
    "bakery": N("pekárna", "piekarnia", "пекарня", "საცხობი", "מאפייה"),
    "pirozhki": N("pirožky a sladké pečivo", "pieczone pierożki i słodkie wypieki", "пирожки и выпечка", "ღვეზელები და ნამცხვრები", "מאפים ממולאים"),
    "beach_poti": N("pláž u Poti — písek a borovice", "plaża koło Poti", "пляж у Поти", "პლაჟი ფოთთან", "חוף ליד פוטי"),
    "black_sand": N("pláž s černým pískem", "plaża z czarnym piaskiem", "пляж с чёрным песком", "შავი ქვიშის პლაჟი", "חוף חול שחור"),
    "magnetic": N("černý magnetický písek", "czarny piasek magnetyczny", "чёрный магнитный песок", "შავი მაგნიტური ქვიშა", "חול שחור מגנטי"),
    "fishing": N("rybaření", "wędkowanie", "рыбалка", "თევზაობა", "דיג"),
    "fishing_paid": N("placené rybaření", "łowisko komercyjne", "платная рыбалка", "ფასიანი თევზაობა", "דיג בתשלום"),
    "pork_knee": N("pečené koleno", "pieczona golonka", "запечённая рулька", "შემწვარი კოჭი", "ברך צלויה"),
    "pizza_cheap": N("levná a dobrá pizza", "tania i dobra pizza", "недорогая и вкусная пицца", "იაფი და გემრიელი პიცა", "פיצה טובה וזולה"),
    "pizza_pasta": N("pizza, saláty a těstoviny", "pizza, sałatki i makarony", "пицца, салаты и паста", "პიცა, სალათები, პასტა", "פיצה, סלטים ופסטה"),
    "kids_verified": N("prověřeno s dětmi — chačapuri a kompot skvělé, chinkali spíš pro dospělé", "sprawdzone z dziećmi — chaczapuri i kompot super, chinkali raczej dla dorosłych", "проверено с детьми — хачапури и компот отличные, хинкали скорее для взрослых", "ბავშვებთან ნაცადი — ხაჭაპური და კომპოტი შესანიშნავია", "נבדק עם ילדים — החצ׳פורי והקומפוט מעולים, החינקלי יותר למבוגרים"),
    "pulled_meat": N("vyhlášené trhané maso", "słynne szarpane mięso", "знаменитое рваное мясо", "განთქმული ხორცი", "בשר נתלש מפורסם"),
    "wine_house": N("vinařství s degustací a prodejem", "winiarnia z degustacją", "винодельня с дегустацией", "ღვინის სახლი დეგუსტაციით", "יקב עם טעימות"),
    "mall_wine": N("obchodní centrum, uvnitř vinotéka Vinceria", "centrum handlowe z winoteką Vinceria", "ТЦ, внутри винотека Vinceria", "სავაჭრო ცენტრი ღვინის მაღაზიით", "קניון עם חנות יין Vinceria"),
    "mall": N("obchodní centrum", "centrum handlowe", "торговый центр", "სავაჭრო ცენტრი", "קניון"),
    "fixprice": N("levné drobnosti do domácnosti", "tanie drobiazgi do domu", "недорогие мелочи для дома", "იაფი წვრილმანები", "חפצים זולים לבית"),
    "kids_corner": N("dětský koutek", "kącik dla dzieci", "детский уголок", "საბავშვო კუთხე", "פינת ילדים"),
    "kids_clothes": N("dětské oblečení", "odzież dziecięca", "детская одежда", "საბავშვო ტანსაცმელი", "בגדי ילדים"),
    "kids_goods": N("dětské zboží a hračky", "artykuły dziecięce i zabawki", "детские товары и игрушки", "საბავშვო ნივთები", "מוצרי ילדים וצעצועים"),
    "kids_center": N("dětské centrum a herna", "centrum zabaw dla dzieci", "детский центр", "საბავშვო ცენტრი", "מרכז משחקים לילדים"),
    "zoo": N("městská zoo", "miejskie zoo", "городской зоопарк", "ზოოპარკი", "גן חיות עירוני"),
    "birds": N("ptačí zoo", "ptasie zoo", "птичий зоопарк", "ფრინველების ზოოპარკი", "גן ציפורים"),
    "circus": N("cirkus", "cyrk", "цирк", "ცირკი", "קרקס"),
    "spa": N("spa a masáže", "spa i masaże", "спа и массаж", "სპა და მასაჟი", "ספא ועיסויים"),
    "beauty": N("kosmetický salon", "salon kosmetyczny", "салон красоты", "სილამაზის სალონი", "סלון יופי"),
    "cosmetics": N("kosmetika", "kosmetyki", "косметика", "კოსმეტიკა", "קוסמטיקה"),
    "by_cosmetics": N("běloruská kosmetika", "kosmetyki białoruskie", "белорусская косметика", "ბელორუსული კოსმეტიკა", "קוסמטיקה בלארוסית"),
    "books": N("knihkupectví", "księgarnia", "книжный магазин", "წიგნების მაღაზია", "חנות ספרים"),
    "art_shop": N("umění a výtvarné potřeby", "sztuka i artykuły plastyczne", "искусство и товары для творчества", "ხელოვნების მაღაზია", "אמנות וציוד יצירה"),
    "jewelry": N("šperky a suvenýry", "biżuteria i pamiątki", "украшения и сувениры", "სამკაულები და სუვენირები", "תכשיטים ומזכרות"),
    "farmers": N("farmářský trh — ovoce, zelenina, sýry", "targ rolny — owoce, warzywa, sery", "фермерский рынок", "ფერმერული ბაზარი", "שוק איכרים — פירות, ירקות, גבינות"),
    "by_shop": N("běloruské potraviny", "produkty białoruskie", "белорусские продукты", "ბელორუსული პროდუქტები", "מוצרי מזון בלארוסיים"),
    "hopa": N("bazar v tureckém Hopa — oblíbený nákupní výlet za hranice", "bazar w tureckiej Hopie — wypad na zakupy za granicę", "базар в турецкой Хопе — за покупками через границу", "ბაზარი თურქულ ხოფაში", "בזאר בהופה שבטורקיה — טיול קניות מעבר לגבול"),
    "electronics": N("elektro", "elektronika", "электроника", "ელექტრონიკა", "אלקטרוניקה"),
    "sushi": N("sushi", "sushi", "суши", "სუში", "סושי"),
    "chebureki": N("čebureky — smažené plněné placky", "czebureki — smażone placki z nadzieniem", "чебуреки", "ჩებურეკები", "צ׳בורקי — כיסונים מטוגנים"),
    "greek": N("řecká kuchyně", "kuchnia grecka", "греческая кухня", "ბერძნული სამზარეულო", "מטבח יווני"),
    "cafe": N("kavárna", "kawiarnia", "кафе", "კაფე", "בית קפה"),
    "fountains": N("zpívající fontány — večer hudba a světla", "śpiewające fontanny — wieczorem muzyka i światła", "поющие фонтаны — вечером музыка и подсветка", "მომღერალი შადრევნები", "מזרקות שרות — מוזיקה ואורות בערב"),
    "cable_car": N("lanovka s výhledem na město a moře", "kolejka linowa z widokami", "канатная дорога с видами", "საბაგირო გზა ხედებით", "רכבל עם נוף לעיר ולים"),
    "alphabet": N("věž gruzínské abecedy", "wieża alfabetu gruzińskiego", "башня грузинского алфавита", "ანბანის კოშკი", "מגדל האלפבית הגאורגי"),
    "sculpture": N("socha na náměstí", "rzeźba na placu", "скульптура на площади", "ქანდაკება მოედანზე", "פסל בכיכר"),
    "white_house": N("bílý palác u moře s restaurací", "biały pałac nad morzem z restauracją", "белый дворец у моря с рестораном", "თეთრი სასახლე ზღვასთან", "ארמון לבן ליד הים עם מסעדה"),
    "piazza_n": N("náměstí v italském stylu, večer živá hudba", "plac w stylu włoskim, wieczorami muzyka", "площадь в итальянском стиле", "იტალიური სტილის მოედანი", "כיכר בסגנון איטלקי"),
    "boulevard": N("sedmikilometrová promenáda podél moře", "7-km promenada nad morzem", "7-км приморский бульвар", "7 კმ ბულვარი ზღვის გასწვრივ", "טיילת של 7 ק״מ לאורך הים"),
    "alinino": N("pohyblivá socha lásky, nejhezčí při západu slunce", "ruchoma rzeźba miłości, najładniejsza o zachodzie", "движущаяся скульптура любви", "სიყვარულის მოძრავი ქანდაკება", "פסל האהבה הנע — הכי יפה בשקיעה"),
    "botanic": N("jedna z největších botanických zahrad světa", "jeden z największych ogrodów botanicznych świata", "один из крупнейших ботсадов мира", "ერთ-ერთი უდიდესი ბოტანიკური ბაღი", "מהגנים הבוטניים הגדולים בעולם"),
    "gonio": N("římská pevnost z 1. století", "rzymska twierdza z I wieku", "римская крепость I века", "რომაული ციხე", "מבצר רומי מהמאה הראשונה"),
    "makhuntseti": N("vodopád a kamenný most královny Tamary", "wodospad i kamienny most królowej Tamary", "водопад и мост царицы Тамары", "ჩანჩქერი და თამარის ხიდი", "מפל וגשר אבן עתיק"),
    "city_beach": N("oblázková pláž u bulváru", "kamienista plaża przy bulwarze", "галечный пляж у бульвара", "პლაჟი ბულვართან", "חוף חלוקים ליד הטיילת"),
    "green_cape": N("klidnější pláž pod botanickou zahradou", "spokojniejsza plaża pod ogrodem botanicznym", "спокойный пляж у ботсада", "მშვიდი პლაჟი", "חוף שקט מתחת לגן הבוטני"),
    "kvariati": N("nejčistší voda v okolí, u tureckých hranic", "najczystsza woda, przy granicy z Turcją", "самая чистая вода, у границы", "ყველაზე სუფთა წყალი", "המים הצלולים באזור"),
    "carrefour": N("velký supermarket", "duży supermarket", "большой супермаркет", "დიდი სუპერმარკეტი", "סופרמרקט גדול"),
    "boni": N("místní trh — ovoce, sýry, koření", "lokalny targ — owoce, sery, przyprawy", "местный рынок", "ადგილობრივი ბაზარი", "שוק מקומי"),
    "market_mix": N("trh s oblečením a ovocem", "targ z odzieżą i owocami", "рынок одежды и фруктов", "ტანსაცმლისა და ხილის ბაზარი", "שוק בגדים ופירות"),
    "wooden": N("pláž s dřevěnými moly", "plaża z drewnianymi pomostami", "пляж с деревянными настилами", "პლაჟი ხის მოედნებით", "חוף עם משטחי עץ"),
    "parking": N("parkoviště u pláže", "parking przy plaży", "парковка у пляжа", "პარკინგი პლაჟთან", "חניה ליד החוף"),
    "beach": N("pláž", "plaża", "пляж", "პლაჟი", "חוף"),
}

NAME = {
    2:  N("Dětský koutek", "Kącik dla dzieci", "Детский уголок", "საბავშვო კუთხე", "פינת ילדים"),
    16: N("Trh s oblečením a ovocem", "Targ z odzieżą i owocami", "Рынок одежды и фруктов", "ბაზარი", "שוק בגדים ופירות"),
    50: N("Soutok dvou řek", "Zbieg dwóch rzek", "Слияние двух рек", "ორი მდინარის შესართავი", "מפגש שני נהרות"),
    58: N("Pečené koleno (46 Gorgiladze)", "Golonka (46 Gorgiladze)", "Рулька (46 Горгиладзе)", "კოჭი (გორგილაძის 46)", "ברך צלויה (גורגילדזה 46)"),
    66: N("Dřevěná pláž", "Drewniana plaża", "Деревянный пляж", "ხის პლაჟი", "חוף העץ"),
    67: N("Parkoviště — dřevěná pláž", "Parking — drewniana plaża", "Парковка — деревянный пляж", "პარკინგი — ხის პლაჟი", "חניה — חוף העץ"),
    68: N("Pláž u Makhinjauri", "Plaża koło Makhinjauri", "Пляж у Махинджаури", "პლაჟი მახინჯაურთან", "חוף ליד מחינג׳אורי"),
    97: N("Ptačí zoo", "Ptasie zoo", "Птичий зоопарк", "ფრინველების ზოო", "גן ציפורים"),
}

CURATED = [
    ("food", "carrefour", N("Carrefour — Batumi Mall", "Carrefour — Batumi Mall", "Carrefour — Batumi Mall", "Carrefour — Batumi Mall", "קרפור — Batumi Mall"), "https://maps.google.com/?q=Carrefour+Batumi+Mall"),
    ("food", "boni", N("Tržnice Boni", "Targ Boni", "Рынок Бони", "ბონის ბაზარი", "שוק בוני"), "https://maps.google.com/?q=Boni+Bazaar+Batumi"),
]

PLACES = [
    ("sights", [103], "sculpture", None), ("sights", [52], "white_house", "White Rcheuli Makhinjauri"),
    ("trips", [21], "thermal", "Hot spring sulfur (Dikhashkho)"),
    ("trips", [22], "thermal", "Public sulphur bath (Amaghleba)"), ("trips", [23], "thermal_pool", "Sulfur Pool Vani"),
    ("trips", [50], "confluence", 50), ("trips", [49], "boat", "Boat trip — Kibe"),
    ("beaches", [66], "wooden", 66), ("beaches", [68], "beach", 68), ("beaches", [67], "parking", 67),
    ("beaches", [53], "beach_poti", None), ("beaches", [14], "fishing_pier", None),
    ("beaches", [54], "fishing", None), ("beaches", [61], "fishing_paid", None),
    ("georgian", [73], "kids_verified", None), ("georgian", [9], "khinkali", None),
    ("georgian", [13], "khachapuri", None), ("georgian", [5], "shashlik", None),
    ("georgian", [58], "pork_knee", 58), ("georgian", [77], "pulled_meat", None),
    ("georgian", [12], "grest", None), ("georgian", [17], "grest", None),
    ("georgian", [24], "rest_prices", None), ("georgian", [25], "rest", None),
    ("georgian", [26], "rest", None), ("georgian", [27], "grest", None),
    ("georgian", [59], "grest", None), ("georgian", [70], "grest", None),
    ("georgian", [74], "grest", None), ("georgian", [110], "rest", None),
    ("georgian", [112], "rest", None), ("georgian", [119], "rest", "Magnolia — მაგნოლია"),
    ("georgian", [122], "grest", None), ("georgian", [123], "grest", None),
    ("georgian", [127], "rest", None), ("georgian", [128], "grest", None),
    ("georgian", [129], "grest", None),
    ("world", [118], "sushi", None), ("world", [124], "sushi", "Sushishvili — სუშიშვილი"),
    ("world", [113], "chebureki", None), ("world", [114], "chebureki", None),
    ("world", [117], "chebureki", None), ("world", [115], "greek", None),
    ("world", [78], "rest", None), ("world", [72], "pizza_cheap", None),
    ("world", [60], "pizza_pasta", None), ("world", [44], "buffet", "Lunch Time — ლანჩ თაიმი"),
    ("world", [45], "canteen", "15 Inasaridze St"), ("world", [75, 76], "canteen", "Mzeo's Kitchen"),
    ("world", [120], "canteen", None), ("world", [121], "canteen", None),
    ("world", [42], "ready_food", "8 Griboedov St"),
    ("cafes", [1], "pastry", None), ("cafes", [20], "cafe", None),
    ("cafes", [6], "photo_spot", None), ("cafes", [125], "cafe", None),
    ("cafes", [51], "bakery", None), ("cafes", [109], "bakery", None),
    ("cafes", [64, 65], "pirozhki", "Nako.bakery"),
    ("wine", [63], "wine_house", None), ("wine", [43], "beer", None), ("wine", [126], "beer_pub", None),
    ("food", [30], "our_shop", "Grocery store (Adlia)"), ("food", [32], "groceries", None),
    ("food", [29], "groceries", None), ("food", [33], "groceries", "Mini-market (Adlia)"),
    ("food", [36, 37, 38], "supermarket", "Kalata"), ("food", [39, 40], "supermarket", "Tursa"),
    ("food", [69], "supermarket", "AgroHub Batumi"), ("food", [102], "supermarket", None),
    ("food", [31], "supermarket", "Interspar (Daily market)"), ("food", [100], "farmers", "Open Farmers' Market"),
    ("food", [16], "market_mix", 16), ("food", [101], "by_shop", "Bulbaland"), ("food", [108], "hopa", None),
    ("shopping", [19], "mall_wine", None), ("shopping", [116], "mall", None),
    ("shopping", [7], "clothes_toys", None), ("shopping", [81], "fixprice", None),
    ("shopping", [10], "clothes", None), ("shopping", [11], "bags", None),
    ("shopping", [3], "souvenirs", None), ("shopping", [4], "souvenirs", "Old Batumi Handmade"),
    ("shopping", [46], "souvenirs", "21 Noe Zhordania St"), ("shopping", [94], "jewelry", "Art v Batumi"),
    ("shopping", [83], "art_shop", "96 Vakhtang Gorgasali St"), ("shopping", [95], "books", None),
    ("shopping", [92], "cosmetics", None), ("shopping", [93], "by_cosmetics", "14 Melikishvili St"),
    ("shopping", [84], "electronics", None), ("shopping", [85], "electronics", None),
    ("kids", [97], "birds", 97),
    ("kids", [91], "kids_center", "131 Chavchavadze St"),
    ("kids", [2], "kids_corner", 2), ("kids", [86], "kids_clothes", "Civil"),
    ("kids", [87], "kids_goods", "21 Tbel-Abuseridze St"),
    ("services", [107], "spa", None), ("services", [105], "beauty", None),
    ("services", [8], "dentist", "31 Zubalashvili St"), ("services", [104], "kids_dentist", None),
]

LBL = {
    "open": N("Otevřeno", "Otwarte", "Открыто", "ღიაა", "פתוח"),
    "price": N("Vstup", "Bilet", "Вход", "შესვლა", "כניסה"),
    "duration": N("Doba návštěvy", "Czas zwiedzania", "Время посещения", "ვიზიტის ხანგრძლივობა", "משך ביקור"),
    "distance": N("Vzdálenost od Batumi", "Odległość od Batumi", "Расстояние от Батуми", "მანძილი ბათუმიდან", "מרחק מבטומי"),
    "ride": N("Doba jízdy", "Czas przejazdu", "Время поездки", "მგზავრობის დრო", "זמן נסיעה"),
    "when": N("Kdy", "Kiedy", "Когда", "როდის", "מתי"),
    "water": N("Voda", "Woda", "Вода", "წყალი", "מים"),
    "surface": N("Povrch", "Nawierzchnia", "Покрытие", "საფარი", "משטח"),
    "length": N("Délka", "Długość", "Длина", "სიგრძე", "אורך"),
    "access": N("Přístup", "Dojazd", "Доступ", "წვდომა", "גישה"),
    "bring": N("Vezměte", "Zabierzcie", "Возьмите", "წაიღეთ", "קחו"),
    "program": N("Program", "Program", "Программа", "პროგრამა", "תוכנית"),
    "equip": N("Vybavení", "Wyposażenie", "Оснащение", "აღჭურვილობა", "ציוד"),
}
TIP = N("Tip", "Wskazówka", "Совет", "რჩევა", "טיפ")
KIDS = N("Pro děti", "Dla dzieci", "Детям", "ბავშვებისთვის", "לילדים")
CREDIT_LABEL = N("Foto", "Zdjęcie", "Фото", "ფოტო", "תמונה")

# ---------- highlighty: bohaté rozbalovací karty s fakty (ověřeno webem, červenec 2026) ----------
HIGHLIGHTS = [
  dict(id="alphabet", cat="sights",
    tag=N("Věž", "Wieża", "Башня", "კოშკი", "მגדל"),
    photo="alphabet.webp", credit="Andrew Milligan sumo", license="CC BY 2.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Alphabet_Tower,_Batumi.jpg",
    title=N("Věž gruzínské abecedy", "Wieża alfabetu gruzińskiego", "Башня грузинского алфавита", "ანბანის კოშკი", "מגדל האלפבית הגאורגי"),
    lead=N(
      "130 metrů vysoká věž s vyhlídkovou plošinou a otáčecí restaurací — fasádu tvoří všech 33 písmen jedinečné gruzínské abecedy.",
      "130-metrowa wieża z tarasem widokowym i obracającą się restauracją — fasadę tworzy wszystkie 33 litery gruzińskiego alfabetu.",
      "130-метровая башня со смотровой площадкой и вращающимся рестораном — фасад составляют все 33 буквы грузинского алфавита.",
      "130 მეტრის სიმაღლის კოშკი სათვალთვალო მოედნითა და მბრუნავი რესტორნით — ფასადს ქმნის ქართული ანბანის ყველა 33 ასო.",
      "מגדל בגובה 130 מטר עם מרפסת תצפית ומסעדה מסתובבת — החזית בנויה מכל 33 האותיות של האלפבית הגאורגי הייחודי."),
    stats=[("open", N("denně 11:00–24:00","codziennie 11:00–24:00","ежедневно 11:00–24:00","ყოველდღე 11:00–24:00","יומי 11:00–24:00")),
           ("price", N("20 GEL (děti 5 GEL)","20 GEL (dzieci 5 GEL)","20 GEL (дети 5 GEL)","20 ლარი (ბავშვები 5 ლარი)","20 ג׳י (ילדים 5 ג׳י)")),
           ("duration", N("45 min","45 min","45 мин","45 წთ","45 דק׳"))],
    boxes=[("tip", TIP, N("Nahoře je i rotující restaurace — hezké i na večerní západ slunce.","Na górze jest obracająca się restauracja — piękny widok o zachodzie słońca.","Наверху есть вращающийся ресторан — красиво на закате.","ზემოთ მბრუნავი რესტორანია — ლამაზია მზის ჩასვლისას.","למעלה יש מסעדה מסתובבת — יפה גם לשקיעה."))],
    maps=[(None, "https://www.google.com/maps/search/?api=1&query=Alphabetic+Tower+41.656040499999996,41.639461")]),

  dict(id="piazza", cat="sights",
    tag=N("Náměstí", "Plac", "Площадь", "მოედანი", "כיכר"),
    photo="piazza.webp", credit="Uwe Brodrecht", license="CC BY-SA 2.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Batumi_Piazza,_a_townsquare_in_central_Batumi.jpg",
    title=N("Batumi Piazza Square", "Batumi Piazza Square", "Batumi Piazza Square", "ბათუმის პიაცის მოედანი", "כיכר פיאצה בטומי"),
    lead=N(
      "Náměstí v italském stylu z roku 2010 s mozaikou o ploše 106 m² — jednou z největších figurativních mozaik v Evropě — a věží s hodinami. Večer ožívá kavárnami a živou hudbou.",
      "Plac w stylu włoskim z 2010 roku z mozaiką o powierzchni 106 m² — jedną z największych figuratywnych mozaik w Europie — i wieżą zegarową. Wieczorem ożywa kawiarniami i muzyką na żywo.",
      "Площадь в итальянском стиле, 2010 год, с мозаикой площадью 106 м² — одной из крупнейших фигуративных мозаик Европы — и часовой башней. Вечером оживает кафе и живой музыкой.",
      "იტალიური სტილის მოედანი 2010 წლიდან, 106 კვ.მ მოზაიკით — ერთ-ერთი უდიდესი ფიგურული მოზაიკა ევროპაში — და საათის კოშკით. საღამოობით ცოცხლდება კაფეებითა და ცოცხალი მუსიკით.",
      "כיכר בסגנון איטלקי משנת 2010 עם פסיפס בשטח 106 מ״ר — מהגדולים באירופה — ומגדל שעון. בערב מתעוררת לחיים עם בתי קפה ומוזיקה חיה."),
    stats=[("open", N("volně přístupné","wolny wstęp","свободный вход","თავისუფალი შესვლა","כניסה חופשית")),
           ("when", N("nejlepší podvečer","najlepiej wieczorem","лучше вечером","საუკეთესო საღამოს","הכי טוב בערב"))],
    boxes=[("tip", TIP, N("Všimněte si mozaiky na zemi uprostřed náměstí — vznikla z 88 milionů drobných dlaždiček.","Zwróćcie uwagę na mozaikę na ziemi — powstała z 88 milionów małych kafelków.","Обратите внимание на мозаику на земле — она сделана из 88 миллионов маленьких плиток.","მიაქციეთ ყურადღება იატაკის მოზაიკას — შექმნილია 88 მილიონი პატარა ფილისგან.","שימו לב לפסיפס על הרצפה — נוצר מ-88 מיליון אריחים קטנים."))],
    maps=[(None, "https://www.google.com/maps/search/?api=1&query=Batumi+Piazza+Square+41.6495415,41.6411823")]),

  dict(id="cable_car", cat="sights",
    tag=N("Lanovka", "Kolejka linowa", "Канатка", "საბაგირო", "רכבל"),
    photo="cable_car.webp", credit="Andrew Milligan sumo", license="CC BY 2.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Argo_Cable_Car,_Batumi_(51154214428).jpg",
    title=N("Argo Cable Car", "Argo Cable Car", "Канатная дорога Argo", "საბაგირო გზა Argo", "רכבל ארגו"),
    lead=N(
      "Jedna z nejdelších lanovek v regionu vás za 15 minut vyveze na horu Anuria (256 m n. m.) s výhledem na celé město i moře.",
      "Jedna z najdłuższych kolejek linowych w regionie zawiezie was w 15 minut na górę Anuria (256 m n.p.m.) z widokiem na całe miasto i morze.",
      "Одна из самых длинных канатных дорог региона — за 15 минут поднимет вас на гору Анурия (256 м) с видом на город и море.",
      "რეგიონის ერთ-ერთი ყველაზე გრძელი საბაგირო 15 წუთში აგიყვანთ მთა ანურიაზე (256 მ) ქალაქისა და ზღვის ხედით.",
      "אחד הרכבלים הארוכים באזור — תוך 15 דקות מטפס להר אנוריה (256 מ׳) עם נוף לעיר ולים."),
    stats=[("open", N("denně 11:00–23:00","codziennie 11:00–23:00","ежедневно 11:00–23:00","ყოველდღე 11:00–23:00","יומי 11:00–23:00")),
           ("price", N("30 GEL tam a zpět (děti 5–12 let 7 GEL)","30 GEL w obie strony (dzieci 5–12 lat 7 GEL)","30 GEL туда-обратно (дети 5–12 лет 7 GEL)","30 ლარი ორმხრივი (ბავშვები 5-12 წლის 7 ლარი)","30 ג׳י הלוך ושוב (ילדים 5-12 שנים 7 ג׳י)")),
           ("ride", N("15 min","15 min","15 мин","15 წთ","15 דק׳"))],
    boxes=[("kids", KIDS, N("Kabinky jsou pro 8 osob a jízda je klidná — vhodné i pro menší děti.","Kabinki są dla 8 osób, przejazd jest spokojny — odpowiedni też dla mniejszych dzieci.","Кабинки на 8 человек, поездка спокойная — подходит и для маленьких детей.","კაბინები 8 კაცისთვისაა, მგზავრობა მშვიდია — შესაფერისია პატარებისთვისაც.","התאים ל-8 אנשים והנסיעה רגועה — מתאים גם לילדים קטנים."))],
    maps=[(None, "https://www.google.com/maps/search/?api=1&query=Argo+Cable+Car+41.6474696,41.6454826")]),

  dict(id="fountains", cat="sights",
    tag=N("Fontány", "Fontanny", "Фонтаны", "შადრევნები", "מזרקות"),
    photo="fountains.webp", credit="Korzana from Moscow, Russia", license="CC BY-SA 2.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Fountain,_batumi.jpg",
    title=N("Tančící fontány", "Tańczące fontanny", "Танцующие фонтаны", "მოცეკვავე შადრევნები", "מזרקות רוקדות"),
    lead=N(
      "Fontány na bulváru večer rozsvítí hudbu, barevná světla a laserovou show — jedny z největších v Evropě.",
      "Fontanny na bulwarze wieczorem ożywają muzyką, kolorowymi światłami i pokazem laserowym — jedne z największych w Europie.",
      "Фонтаны на бульваре вечером оживают музыкой, цветной подсветкой и лазерным шоу — одни из крупнейших в Европе.",
      "შადრევნები ბულვარზე საღამოს გამოცოცხლდება მუსიკით, ფერადი შუქებითა და ლაზერული შოუთი — ერთ-ერთი უდიდესი ევროპაში.",
      "המזרקות בטיילת קמות לחיים בערב עם מוזיקה, אורות צבעוניים ולייזר — מהגדולות באירופה."),
    stats=[("when", N("denně 21:00–2:00, každou hodinu 30 min","codziennie 21:00–2:00, co godzinę 30 min","ежедневно 21:00–2:00, каждый час 30 мин","ყოველდღე 21:00–2:00, ყოველ საათში 30 წთ","יומי 21:00–2:00, כל שעה 30 דק׳")),
           ("price", N("zdarma","za darmo","бесплатно","უფასო","חינם"))],
    boxes=[("tip", TIP, N("Dobré místo na procházku po večeři — hlavní show je u Evropského náměstí a jezera Ardagani.","Dobre miejsce na spacer po kolacji — główny pokaz jest przy placu Europejskim i jeziorze Ardagani.","Хорошее место для прогулки после ужина — главное шоу у Европейской площади и озера Ардагани.","კარგი ადგილი სასეირნოდ ვახშმის შემდეგ — მთავარი შოუ ევროპის მოედანთან და არდაგანის ტბასთანაა.","מקום נחמד לטיול אחרי ארוחת ערב — המופע המרכזי ליד כיכר אירופה ואגם ארדגני."))],
    maps=[(None, "https://www.google.com/maps/search/?api=1&query=Batumi+Boulevard+Fountains+41.6543729,41.6349613")]),

  dict(id="boulevard", cat="sights",
    tag=N("Promenáda", "Promenada", "Променад", "ბულვარი", "טיילת"),
    photo="boulevard.webp",
    title=N("Batumský bulvár", "Bulwar w Batumi", "Батумский бульвар", "ბათუმის ბულვარი", "טיילת בטומי"),
    lead=N(
      "Sedmikilometrová přímořská promenáda podél oblázkové pláže — palmy, parky, cyklostezka i večerní fontány. Páteř města, kterou projdete pěšky, na kole nebo na koloběžce.",
      "Siedmiokilometrowa nadmorska promenada wzdłuż kamienistej plaży — palmy, parki, ścieżka rowerowa i wieczorne fontanny. Kręgosłup miasta, który przejdziecie pieszo, rowerem lub hulajnogą.",
      "Семикилометровый приморский променад вдоль галечного пляжа — пальмы, парки, велодорожка и вечерние фонтаны. Главная артерия города — пешком, на велосипеде или самокате.",
      "შვიდკილომეტრიანი ზღვისპირა პრომენადი კენჭოვანი პლაჟის გასწვრივ — პალმები, პარკები, ველობილიკი და საღამოს შადრევნები.",
      "טיילת ימית באורך שבעה קילומטרים לאורך חוף חלוקים — דקלים, פארקים, שביל אופניים ומזרקות בערב. עמוד השדרה של העיר — ברגל, באופניים או בקורקינט."),
    stats=[("length", "7 km"),
           ("surface", N("dlažba + cyklostezka","bruk + ścieżka rowerowa","мощение + велодорожка","ფილაქანი + ველობილიკი","אבנים + שביל אופניים"))],
    boxes=[("tip", TIP, N("Starý bulvár (jih) je historičtější a klidnější, Nový bulvár (sever) rodinnější, s atrakcemi pro děti.","Stary bulwar (południe) jest bardziej historyczny i spokojny, Nowy (północ) bardziej rodzinny, z atrakcjami dla dzieci.","Старый бульвар (юг) более исторический и спокойный, Новый (север) — семейный, с аттракционами для детей.","ძველი ბულვარი (სამხრეთი) ისტორიული და მშვიდია, ახალი (ჩრდილოეთი) საოჯახოა, ბავშვების გასართობებით.","הטיילת הישנה (דרום) היסטורית ושקטה יותר, החדשה (צפון) משפחתית יותר, עם אטרקציות לילדים."))],
    maps=[(None, "https://maps.google.com/?q=Batumi+Boulevard")]),

  dict(id="alinino", cat="sights",
    tag=N("Socha", "Rzeźba", "Скульптура", "ქანდაკება", "פסל"),
    photo="alinino.webp", credit="Vicuna R", license="CC BY-SA 2.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Nino_and_Ali_Statues_in_Batumi,_2016.jpg",
    title=N("Ali & Nino", "Ali i Nino", "Али и Нино", "ალი და ნინო", "עלי ונינו"),
    lead=N(
      "Pohyblivá socha lásky od Tamary Kvesitadze — dvě 8metrové postavy se každý večer pomalu přibližují, prolnou se skrz sebe a zase oddálí. Připomíná osudovou lásku muslimského chlapce a křesťanské dívky z románu Ali a Nino.",
      "Ruchoma rzeźba miłości autorstwa Tamary Kvesitadze — dwie 8-metrowe postacie co wieczór powoli się zbliżają, przenikają przez siebie i znów oddalają. Przypomina o miłości muzułmańskiego chłopca i chrześcijańskiej dziewczyny z powieści Ali i Nino.",
      "Движущаяся скульптура любви от Тамары Квеситадзе — две 8-метровые фигуры каждый вечер медленно сближаются, проходят друг сквозь друга и отдаляются. Напоминает о любви мусульманского юноши и христианской девушки из романа «Али и Нино».",
      "სიყვარულის მოძრავი ქანდაკება თამარ კვესიტაძისგან — ორი 8-მეტრიანი ფიგურა ყოველ საღამოს ნელა უახლოვდება ერთმანეთს, გადის ერთმანეთში და კვლავ შორდება.",
      "פסל האהבה הנע מאת תמר קווסיטדזה — שתי דמויות בגובה 8 מטר מתקרבות לאט זו לזו כל ערב, חוצות זו את זו ומתרחקות שוב. מזכיר את סיפור האהבה הנידון לכישלון בין נער מוסלמי לנערה נוצרייה מהרומן עלי ונינו."),
    stats=[("when", N("pohyb denně v 19:00, cca 10 min","ruch codziennie o 19:00, ok. 10 min","движение ежедневно в 19:00, около 10 мин","მოძრაობა ყოველდღე 19:00-ზე, დაახლ. 10 წთ","תנועה יומית ב-19:00, כ-10 דק׳")),
           ("price", N("zdarma","za darmo","бесплатно","უფასო","חינם"))],
    boxes=[("tip", TIP, N("Nejhezčí je socha za soumraku, kdy se rozsvítí.","Rzeźba jest najpiękniejsza o zmierzchu, gdy się rozświetla.","Скульптура особенно красива в сумерках, когда подсвечивается.","ქანდაკება ყველაზე ლამაზია დაისზე, როცა ინთება.","הפסל הכי יפה בדמדומים, כשהוא נדלק."))],
    maps=[(None, "https://maps.google.com/?q=Ali+and+Nino+Statue+Batumi")]),

  dict(id="botanic", cat="trips",
    tag=N("Botanická zahrada", "Ogród botaniczny", "Ботанический сад", "ბოტანიკური ბაღი", "גן בוטני"),
    photo="botanic.webp", credit="Gytis from Lithuania", license="CC BY 2.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Batumi_Botanical_Garden_(Batumi_botanikos_sodas).jpg",
    title=N("Batumi Botanical Garden", "Batumi Botanical Garden", "Батумский ботанический сад", "ბათუმის ბოტანიკური ბაღი", "הגן הבוטני של בטומי"),
    lead=N(
      "Jedna z největších botanických zahrad na světě (108 ha) na útesech Zeleného mysu, založená 1912. Přes 2000 druhů dřevin z celého světa, rozdělených do „kontinentálních” sekcí.",
      "Jeden z największych ogrodów botanicznych świata (108 ha) na klifach Zielonego Przylądka, założony w 1912. Ponad 2000 gatunków drzew z całego świata, podzielonych na sekcje „kontynentalne”.",
      "Один из крупнейших ботанических садов мира (108 га) на утёсах Зелёного мыса, основан в 1912 году. Более 2000 видов деревьев со всего мира, разделённых на «континентальные» секции.",
      "ერთ-ერთი უდიდესი ბოტანიკური ბაღი მსოფლიოში (108 ჰა) მწვანე კონცხის კლდეებზე, დაარსდა 1912 წელს. 2000-ზე მეტი ხის სახეობა მთელი მსოფლიოდან.",
      "אחד הגנים הבוטניים הגדולים בעולם (108 הקטר) על צוקי הכף הירוק, נוסד ב-1912. למעלה מ-2000 מיני עצים מכל העולם, מחולקים למדורים \"יבשתיים\"."),
    stats=[("open", N("denně 9:00–18:30 (léto do 20:00)","codziennie 9:00–18:30 (lato do 20:00)","ежедневно 9:00–18:30 (летом до 20:00)","ყოველდღე 9:00–18:30 (ზაფხულში 20:00-მდე)","יומי 9:00–18:30 (בקיץ עד 20:00)")),
           ("price", N("20 GEL (děti do 6 let zdarma)","20 GEL (dzieci do 6 lat za darmo)","20 GEL (дети до 6 лет бесплатно)","20 ლარი (ბავშვები 6 წლამდე უფასო)","20 ג׳י (ילדים עד גיל 6 חינם)")),
           ("duration", N("2–3 h","2–3 godz","2–3 ч","2-3 სთ","2-3 שעות"))],
    boxes=[("tip", TIP, N("Areál je rozlehlý a svažitý — počítejte s pohodlnou obuví, uvnitř jezdí i vláček.","Teren jest rozległy i pochyły — załóżcie wygodne buty, wewnątrz kursuje też pociągik.","Территория обширная и холмистая — наденьте удобную обувь, внутри есть и паровозик.","ტერიტორია დიდი და დახრილია — ჩაიცვით მოსახერხებელი ფეხსაცმელი, შიგნით ბაგირიც დადის.","השטח נרחב ומשופע — נעלו נעליים נוחות, יש גם רכבת פנימית.")),
          ("kids", KIDS, N("Cesty vedou po útesu nad mořem — u dětí hlídejte krajnice.","Ścieżki biegną po klifie nad morzem — pilnujcie dzieci przy krawędziach.","Тропы идут по обрыву над морем — следите за детьми у края.","ბილიკები ზღვის კლდეზე გადის — ბავშვებს ფრთხილად მიხედეთ კიდეებთან.","השבילים עוברים על הצוק מעל הים — השגיחו על הילדים ליד הקצוות."))],
    maps=[(None, "https://maps.google.com/?q=Batumi+Botanical+Garden")]),

  dict(id="gonio", cat="trips",
    tag=N("Pevnost", "Twierdza", "Крепость", "ციხე", "מבצר"),
    photo="gonio.webp", credit="DDohler", license="CC BY 2.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Gonio_fortress_walls.jpg",
    title=N("Pevnost Gonio (Apsaros)", "Twierdza Gonio (Apsaros)", "Крепость Гонио (Апсарос)", "გონიოს ციხე (აფსაროსი)", "מבצר גוניו (אפסארוס)"),
    lead=N(
      "Římská pevnost Apsaros z 1. století, jedna z nejstarších v Gruzii, s dochovanými hradbami a archeologickým muzeem.",
      "Rzymska twierdza Apsaros z I wieku, jedna z najstarszych w Gruzji, z zachowanymi murami i muzeum archeologicznym.",
      "Римская крепость Апсарос I века — одна из старейших в Грузии, с сохранившимися стенами и археологическим музеем.",
      "რომაული ციხე აფსაროსი I საუკუნიდან, ერთ-ერთი უძველესი საქართველოში, შემონახული გალავნითა და არქეოლოგიური მუზეუმით.",
      "מבצר רומי אפסארוס מהמאה הראשונה, מהעתיקים בגאורגיה, עם חומות שרדו ומוזיאון ארכיאולוגי."),
    stats=[("open", N("denně 10:00–18:00","codziennie 10:00–18:00","ежедневно 10:00–18:00","ყოველდღე 10:00–18:00","יומי 10:00–18:00")),
           ("price", N("cca 3–10 GEL","ok. 3–10 GEL","около 3–10 GEL","დაახლ. 3-10 ლარი","כ-3–10 ג׳י"))],
    boxes=[("tip", TIP, N("Ceny i otevírací doba se sezónně mění — doporučujeme ověřit na místě.","Ceny i godziny otwarcia zmieniają się sezonowo — zalecamy sprawdzenie na miejscu.","Цены и часы работы меняются по сезону — рекомендуем уточнить на месте.","ფასები და სამუშაო საათები სეზონურად იცვლება — გირჩევთ ადგილზე გადამოწმებას.","המחירים ושעות הפתיחה משתנים עונתית — מומלץ לבדוק במקום."))],
    maps=[(None, "https://maps.google.com/?q=Gonio+Fortress")]),

  dict(id="makhuntseti", cat="trips",
    tag=N("Vodopád", "Wodospad", "Водопад", "ჩანჩქერი", "מפל"),
    photo="makhuntseti.webp", credit="Wojciech Biegun", license="CC BY-SA 3.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Makhuntseti_Waterfall_-_%E1%83%9B%E1%83%90%E1%83%AE%E1%83%A3%E1%83%9C%E1%83%AA%E1%83%94%E1%83%97%E1%83%98%E1%83%A1_%E1%83%A9%E1%83%90%E1%83%9C%E1%83%A9%E1%83%A5%E1%83%94%E1%83%A0%E1%83%98_-_panoramio.jpg",
    title=N("Vodopád Makhuntseti", "Wodospad Makhuntseti", "Водопад Махунцети", "მახუნცეთის ჩანჩქერი", "מפל מחונצטי"),
    lead=N(
      "30metrový vodopád a kamenný most královny Tamary z 11.–13. století, vzdálené od sebe jen 500 m, asi 30 km od Batumi.",
      "30-metrowy wodospad i kamienny most królowej Tamary z XI–XIII w., oddalone od siebie o 500 m, ok. 30 km od Batumi.",
      "30-метровый водопад и каменный мост царицы Тамары XI–XIII века, в 500 м друг от друга, около 30 км от Батуми.",
      "30 მეტრიანი ჩანჩქერი და თამარ მეფის ქვის ხიდი XI-XIII საუკუნეებიდან, ერთმანეთისგან მხოლოდ 500 მ დაშორებით.",
      "מפל בגובה 30 מטר וגשר אבן של המלכה תמר מהמאות ה-11–13, במרחק 500 מ׳ זה מזה, כ-30 ק״מ מבטומי."),
    stats=[("price", N("zdarma","za darmo","бесплатно","უფასო","חינם")),
           ("distance", "30 km")],
    boxes=[("kids", KIDS, N("U vodopádu je kluzko a proud silný — děti hlídejte na dosah ruky.","Przy wodospadzie jest ślisko, a nurt silny — trzymajcie dzieci blisko siebie.","У водопада скользко, течение сильное — держите детей рядом.","ჩანჩქერთან სრიალაა და დინება ძლიერი — ბავშვები ხელთან გეყოლებოდეთ.","ליד המפל חלק והזרם חזק — השאירו את הילדים בהישג יד."))],
    maps=[(None, "https://maps.google.com/?q=Makhuntseti+Waterfall")]),

  dict(id="gomis_mta", cat="trips",
    tag=N("Vyhlídka", "Punkt widokowy", "Смотровая", "სანახავი ადგილი", "תצפית"),
    title=N("Gomis Mta Viewpoint", "Gomis Mta Viewpoint", "Смотровая Gomis Mta", "გომის მთის სანახავი ადგილი", "תצפית גומיס מטה"),
    lead=N(
      "Vyhlídka na hřebeni ve výšce cca 2100 m, odkud za dobrého počasí vidíte pod sebou „moře mraků”. Nejlepší za svítání nebo při západu slunce.",
      "Punkt widokowy na grzbiecie na wysokości ok. 2100 m, skąd przy dobrej pogodzie widać pod sobą „morze chmur”. Najlepiej o świcie lub zachodzie słońca.",
      "Смотровая площадка на хребте на высоте около 2100 м, откуда в хорошую погоду видно «море облаков» под ногами. Лучше всего на рассвете или закате.",
      "სანახავი ადგილი ქედზე, დაახლ. 2100 მ სიმაღლეზე, საიდანაც კარგი ამინდის დროს ქვემოთ „ღრუბლების ზღვას” ხედავთ.",
      "תצפית על רכס בגובה כ-2100 מ׳, שממנה בימים בהירים רואים \"ים של עננים\" מתחת. הכי יפה בזריחה או בשקיעה."),
    stats=[("access", N("terénním autem (4×4) z Ozurgeti","terenowym autem (4×4) z Ozurgeti","на внедорожнике (4×4) из Озургети","4×4 მანქანით ოზურგეთიდან","ברכב שטח (4X4) מאוזורגטי")),
           ("bring", N("teplé oblečení (v noci pod 8 °C)","ciepłe ubranie (nocą poniżej 8°C)","тёплую одежду (ночью ниже 8°C)","თბილი ტანსაცმელი (ღამით 8°C-ზე დაბლა)","בגדים חמים (בלילה מתחת ל-8°C)"))],
    boxes=[("tip", TIP, N("Počasí se tu mění rychle — bez mraků žádný „efekt moře”, raději ověřte předpověď.","Pogoda zmienia się tu szybko — bez chmur nie ma „efektu morza”, sprawdźcie prognozę.","Погода здесь быстро меняется — без облаков не будет «эффекта моря», проверьте прогноз.","ამინდი აქ სწრაფად იცვლება — ღრუბლების გარეშე „ზღვის ეფექტი” არ იქნება, გადაამოწმეთ პროგნოზი.","מזג האוויר משתנה כאן מהר — בלי עננים אין \"אפקט ים\", כדאי לבדוק תחזית."))],
    maps=[(None, "https://www.google.com/maps/search/?api=1&query=Gomis+Mta+Viewpoint+41.8273953,42.157319799999996")]),

  dict(id="dendro", cat="trips",
    tag=N("Park", "Park", "Парк", "პარკი", "פארק"),
    photo="dendro.webp", credit="Gaga.vaa", license="CC BY-SA 4.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Shekvetili_Park.jpg",
    title=N("Dendrologický park Shekvetili", "Park Dendrologiczny Shekvetili", "Дендропарк Шекветили", "შეკვეთილის დენდროლოგიური პარკი", "הפארק הבוטני של שקווטילי"),
    lead=N(
      "60hektarový park s přesazenými vzácnými stromy ze západní Gruzie i exotickými druhy z pěti kontinentů. Žijí tu i lemuři, plameňáci a desítky druhů papoušků a ptáků.",
      "60-hektarowy park z przesadzonymi rzadkimi drzewami z zachodniej Gruzji i egzotycznymi gatunkami z pięciu kontynentów. Żyją tu też lemury, flamingi i dziesiątki gatunków papug i ptaków.",
      "Парк площадью 60 га с пересаженными редкими деревьями Западной Грузии и экзотическими видами с пяти континентов. Здесь живут лемуры, фламинго и десятки видов попугаев и птиц.",
      "60 ჰექტარი პარკი დასავლეთ საქართველოდან გადმოტანილი იშვიათი ხეებითა და ეგზოტიკური სახეობებით ხუთივე კონტინენტიდან. აქ ცხოვრობენ ლემურები, ფლამინგოები და ათობით სახეობის თუთიყუში და ჩიტი.",
      "פארק בשטח 60 הקטר עם עצים נדירים שהועברו ממערב גאורגיה ומינים אקזוטיים מחמש יבשות. חיים כאן גם למורים, פלמינגו ועשרות מיני תוכים וציפורים."),
    stats=[("price", N("zdarma","za darmo","бесплатно","უფასო","חינם")),
           ("distance", "45 km")],
    boxes=[("kids", KIDS, N("Lemuři a plameňáci jsou hlavní hvězdy pro nejmenší návštěvníky.","Lemury i flamingi są głównymi gwiazdami dla najmłodszych.","Лемуры и фламинго — главные звёзды для самых маленьких.","ლემურები და ფლამინგოები მთავარი ვარსკვლავებია პატარებისთვის.","הלמורים והפלמינגו הם הכוכבים הגדולים עבור הקטנים ביותר."))],
    maps=[(N("Hlavní vstup","Wejście główne","Главный вход","მთავარი შესასვლელი","הכניסה הראשית"), "https://www.google.com/maps/search/?api=1&query=Shekvetili+Dendrological+Park+41.959149499999995,41.772186399999995"),
          (N("Vstup se zvířaty","Wejście ze zwierzętami","Вход с животными","შესასვლელი ცხოველებით","כניסה עם בעלי חיים"), "https://www.google.com/maps/search/?api=1&query=Shekvetili+Park+Zoo+41.961338,41.7637301")]),

  dict(id="city_beach", cat="beaches",
    tag=N("Pláž", "Plaża", "Пляж", "პლაჟი", "חוף"),
    photo="city_beach.webp", credit="Jonathan Cardy", license="CC BY-SA 3.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Batumi_Beach_in_2012_02.jpg",
    title=N("Městská pláž", "Plaża miejska", "Городской пляж", "ქალაქის პლაჟი", "חוף העיר"),
    lead=N(
      "Oblázková pláž táhnoucí se podél celého bulváru — během chvilky jste v centru i u vody.",
      "Kamienista plaża ciągnąca się wzdłuż całego bulwaru — w kilka minut jesteście w centrum i nad wodą.",
      "Галечный пляж вдоль всего бульвара — за пару минут вы и в центре, и у воды.",
      "კენჭოვანი პლაჟი მთელი ბულვარის გასწვრივ — რამდენიმე წუთში ცენტრშიც ხართ და წყალთანაც.",
      "חוף חלוקים לאורך כל הטיילת — תוך דקות אתם גם במרכז העיר וגם ליד המים."),
    stats=[("surface", N("oblázky","kamyki","галька","კენჭები","חלוקים")),
           ("distance", N("pár minut z bytu","kilka minut od mieszkania","пара минут от квартиры","ბინიდან რამდენიმე წუთი","דקות ספורות מהדירה"))],
    boxes=[("tip", TIP, N("Voda hlouběji klesá rychleji než na písčitých plážích — s malými dětmi zůstaňte blíž břehu.","Woda głębieje szybciej niż na piaszczystych plażach — z małymi dziećmi zostańcie bliżej brzegu.","Глубина нарастает быстрее, чем на песчаных пляжах — с малышами держитесь ближе к берегу.","წყალი უფრო სწრაფად ღრმავდება ვიდრე ქვიშიან პლაჟებზე — პატარებთან ნაპირთან ახლოს დარჩით.","המים מעמיקים מהר יותר מאשר בחופי חול — עם ילדים קטנים הישארו קרוב לחוף."))],
    maps=[(None, "https://maps.google.com/?q=Batumi+Beach")]),

  dict(id="green_cape", cat="beaches",
    tag=N("Pláž", "Plaża", "Пляж", "პლაჟი", "חוף"),
    photo="green_cape.webp", credit="Krzysztof Ziarnek, Kenraiz", license="CC BY-SA 4.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Mtsvane_Kontskhi_Beach_kz1.jpg",
    title=N("Zelený mys (Mtsvane Kontskhi)", "Zielony Przylądek (Mtsvane Kontskhi)", "Зелёный мыс (Мцване Концхи)", "მწვანე კონცხი", "הכף הירוק (מצוואנה קונצחי)"),
    lead=N(
      "Klidnější pláž pod útesy botanické zahrady, asi 9 km od centra — 500 m oblázkového pobřeží obklopeného zelení.",
      "Spokojniejsza plaża pod klifami ogrodu botanicznego, ok. 9 km od centrum — 500 m kamienistego wybrzeża otoczonego zielenią.",
      "Более спокойный пляж под утёсами ботанического сада, около 9 км от центра — 500 м галечного берега в зелени.",
      "მშვიდი პლაჟი ბოტანიკური ბაღის კლდეების ქვეშ, ცენტრიდან დაახლ. 9 კმ — 500 მ კენჭოვანი სანაპირო მწვანილში.",
      "חוף שקט יותר מתחת לצוקי הגן הבוטני, כ-9 ק״מ מהמרכז — 500 מ׳ של חוף חלוקים מוקף ירק."),
    stats=[("distance", "9 km")],
    boxes=[("tip", TIP, N("Kombinujte s návštěvou botanické zahrady — vstup k pláži je nahoře po schodech ze zahrady.","Połączcie z wizytą w ogrodzie botanicznym — wejście na plażę jest po schodach z ogrodu.","Совместите с посещением ботанического сада — вход на пляж по лестнице из сада.","გააერთიანეთ ბოტანიკური ბაღის ვიზიტთან — პლაჟზე შესასვლელი ბაღიდან კიბეზეა.","שלבו עם ביקור בגן הבוטני — הכניסה לחוף היא במדרגות מהגן."))],
    maps=[(None, "https://maps.google.com/?q=Mtsvane+Kontskhi+Green+Cape")]),

  dict(id="kvariati", cat="beaches",
    tag=N("Pláž", "Plaża", "Пляж", "პლაჟი", "חוף"),
    photo="kvariati.webp", credit="Lukas Kaladze", license="CC BY-SA 4.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Black_sea_coastline_-_Kvariati,_Georgia.jpg",
    title=N("Kvariati a Sarpi", "Kvariati i Sarpi", "Квариати и Сарпи", "კვარიათი და სარფი", "קווריאטי וסרפי"),
    lead=N(
      "Nejčistší voda v okolí, jen 3 km od tureckých hranic. Široká oblázková pláž (až 50 m) mezi horami, s jediným potápěčským centrem v Gruzii přímo na pláži.",
      "Najczystsza woda w okolicy, zaledwie 3 km od granicy z Turcją. Szeroka kamienista plaża (do 50 m) między górami, z jedynym w Gruzji centrum nurkowym.",
      "Самая чистая вода в округе, всего 3 км от границы с Турцией. Широкий галечный пляж (до 50 м) среди гор, с единственным в Грузии дайвинг-центром на пляже.",
      "ყველაზე სუფთა წყალი მიდამოებში, თურქეთის საზღვრიდან მხოლოდ 3 კმ-ში. ფართო კენჭოვანი პლაჟი (50 მ-მდე) მთებს შორის.",
      "המים הצלולים ביותר באזור, רק 3 ק״מ מגבול טורקיה. חוף חלוקים רחב (עד 50 מ׳) בין ההרים, עם מרכז הצלילה היחיד בגאורגיה ממש על החוף."),
    stats=[("distance", N("cca 20 km","ok. 20 km","около 20 км","დაახლ. 20 კმ","כ-20 ק״מ")),
           ("equip", N("převlékárny, lehátka, půjčovna","przebieralnie, leżaki, wypożyczalnia","кабинки, лежаки, прокат","გასახდელები, ტახტები, გაქირავება","תאי הלבשה, כיסאות, השכרה"))],
    boxes=[("tip", TIP, N("Jediné potápěčské centrum v Gruzii je přímo tady — kdo chce zkusit potápění s výcvikem PADI, je to ono místo.","Jedyne centrum nurkowe w Gruzji jest właśnie tutaj — dla chcących spróbować nurkowania z certyfikatem PADI.","Единственный дайвинг-центр Грузии находится именно здесь — для тех, кто хочет попробовать дайвинг с сертификатом PADI.","საქართველოში ერთადერთი წყალქვეშა ცურვის ცენტრი სწორედ აქაა — PADI სერტიფიკატით დაინტერესებულთათვის.","מרכז הצלילה היחיד בגאורגיה נמצא כאן — למי שרוצה לנסות צלילה עם הסמכת PADI."))],
    maps=[(None, "https://maps.google.com/?q=Kvariati+Beach")]),

  dict(id="magnetic", cat="beaches",
    tag=N("Pláž", "Plaża", "Пляж", "პლაჟი", "חוף"),
    photo="magnetic.webp", credit="M.", license="CC BY-SA 4.0",
    credit_url="https://commons.wikimedia.org/wiki/File:Kaprovani_Shekvetili.jpg",
    title=N("Pláž s magnetickým pískem", "Plaża z magnetycznym piaskiem", "Пляж с магнитным песком", "მაგნიტური ქვიშის პლაჟი", "חוף החול המגנטי"),
    lead=N(
      "Unikátní tmavý písek s vysokým obsahem magnetitu u Šekvetili a Kaprovani — místní mu léta připisují léčebné účinky na klouby a oběh (vědecky nepotvrzeno, ale zážitek to je). Moře je tu mělké a teplé, příjemné i pro děti.",
      "Unikalny ciemny piasek z wysoką zawartością magnetytu koło Shekvetili i Kaprovani — miejscowi od lat przypisują mu lecznicze działanie na stawy i krążenie (naukowo niepotwierdzone, ale warto spróbować). Morze jest tu płytkie i ciepłe, przyjemne też dla dzieci.",
      "Уникальный тёмный песок с высоким содержанием магнетита у Шекветили и Каприловани — местные годами приписывают ему лечебные свойства для суставов и кровообращения (научно не подтверждено, но опыт интересный). Море здесь мелкое и тёплое, приятно и для детей.",
      "უნიკალური მუქი ქვიშა მაგნეტიტის მაღალი შემცველობით შეკვეთილთან და კაპროვანთან — ადგილობრივები წლების განმავლობაში მიაწერენ სასარგებლო თვისებებს სახსრებისთვის.",
      "חול כהה ייחודי עם ריכוז גבוה של מגנטיט ליד שקווטילי וקפרובני — התושבים המקומיים מייחסים לו שנים תכונות מרפא למפרקים ולמחזור הדם (לא מוכח מדעית, אך שווה להתנסות). הים כאן רדוד וחם, נעים גם לילדים."),
    stats=[("distance", N("cca 50 km","ok. 50 km","около 50 км","დაახლ. 50 კმ","כ-50 ק״מ")),
           ("water", N("mělká, teplá (26–28 °C v létě)","płytka, ciepła (26–28°C latem)","мелкое, тёплое (26–28°C летом)","არაღრმა, თბილი (ზაფხულში 26-28°C)","רדודים, חמים (26–28°C בקיץ)"))],
    boxes=[("kids", KIDS, N("Pozvolný vstup do vody a písečné dno — příjemnější pro malé děti než oblázkové pláže u Batumi.","Łagodne wejście do wody i piaszczyste dno — przyjemniejsze dla małych dzieci niż kamieniste plaże w Batumi.","Пологий вход в воду и песчаное дно — приятнее для малышей, чем галечные пляжи Батуми.","წყალში თანდათანობითი შესვლა და ქვიშიანი ფსკერი — პატარებისთვის უფრო სასიამოვნო ვიდრე ბათუმის კენჭოვანი პლაჟები.","כניסה מתונה למים וקרקעית חולית — נעים יותר לילדים קטנים מחופי החלוקים בבטומי."))],
    maps=[(N("Šekvetili","Shekvetili","Шекветили","შეკვეთილი","שקווטילי"), "https://www.google.com/maps/search/?api=1&query=Magnetic+sands+beach+41.9215709,41.766529999999996"),
          (N("Kaprovani","Kaprovani","Каприлвани","კაპროვანი","קפרובני"), "https://www.google.com/maps/search/?api=1&query=Kaprovani+beach+41.962347199999996,41.762206899999995")]),

  dict(id="zoo", cat="kids",
    tag=N("Zoo", "Zoo", "Зоопарк", "ზოო", "גן חיות"),
    title=N("Batumi City Zoo", "Batumi City Zoo", "Батумский зоопарк", "ბათუმის ზოოპარკი", "גן החיות של בטומי"),
    lead=N(
      "Městská zoo založená 1975 na ploše 6 ha, s místními i exotickými druhy zvířat.",
      "Miejskie zoo założone w 1975, na powierzchni 6 ha, z lokalnymi i egzotycznymi gatunkami zwierząt.",
      "Городской зоопарк, основан в 1975 году, площадь 6 га, местные и экзотические виды животных.",
      "საქალაქო ზოოპარკი დაარსდა 1975 წელს, 6 ჰექტარზე, ადგილობრივი და ეგზოტიკური ცხოველების სახეობებით.",
      "גן חיות עירוני שנוסד ב-1975, בשטח 6 הקטר, עם מינים מקומיים ואקזוטיים."),
    stats=[("open", N("11:00–19:00, přestávka 14–17, po zavřeno","11:00–19:00, przerwa 14–17, pon. zamknięte","11:00–19:00, перерыв 14–17, пн выходной","11:00–19:00, შესვენება 14-17, ორშ. დაკეტილია","11:00–19:00, הפסקה 14–17, סגור בימי שני")),
           ("price", N("2 GEL","2 GEL","2 GEL","2 ლარი","2 ג׳י"))],
    boxes=[("kids", KIDS, N("Symbolická cena a menší rozloha — ideální na kratší návštěvu, než děti unaví.","Symboliczna cena i mniejsza powierzchnia — idealne na krótszą wizytę.","Символическая цена и небольшая территория — идеально для короткого визита.","სიმბოლური ფასი და პატარა ტერიტორია — იდეალურია მოკლე ვიზიტისთვის.","מחיר סמלי ושטח קטן — אידיאלי לביקור קצר לפני שהילדים מתעייפים."))],
    maps=[(None, "https://www.google.com/maps/search/?api=1&query=Batumi+City+Zoo+41.6468274,41.6279681")]),

  dict(id="circus", cat="kids",
    tag=N("Cirkus", "Cyrk", "Цирк", "ცირკი", "קרקס"),
    title=N("STAR Circus Georgia", "STAR Circus Georgia", "STAR Circus Georgia", "STAR Circus Georgia", "STAR Circus Georgia"),
    lead=N(
      "Cirkusová aréna v Batumi s letním programem — akrobacie, žonglování a artistická show pro celou rodinu.",
      "Arena cyrkowa w Batumi z letnim programem — akrobacje, żonglerka i show artystyczne dla całej rodziny.",
      "Цирковая арена в Батуми с летней программой — акробатика, жонглирование и артистическое шоу для всей семьи.",
      "ცირკის არენა ბათუმში ზაფხულის პროგრამით — აკრობატიკა, ჟონგლიორობა და საოჯახო შოუ.",
      "זירת קרקס בבטומי עם תוכנית קיץ — אקרובטיקה, ג׳אגלינג ומופע אמנותי לכל המשפחה."),
    stats=[("program", N("mění se sezónně, ověřte aktuální","zmienia się sezonowo, sprawdźcie aktualny","меняется сезонно, уточните актуальную","სეზონურად იცვლება, გადაამოწმეთ","משתנה עונתית, בדקו את התוכנית העדכנית"))],
    boxes=[("tip", TIP, N("Vstupenky a aktuální program najdete na starcircus.ge nebo přímo na místě.","Bilety i aktualny program na starcircus.ge lub bezpośrednio na miejscu.","Билеты и актуальную программу смотрите на starcircus.ge или на месте.","ბილეთები და მიმდინარე პროგრამა — starcircus.ge-ზე ან ადგილზე.","כרטיסים ותוכנית עדכנית באתר starcircus.ge או במקום."))],
    maps=[(None, "https://www.google.com/maps/search/?api=1&query=STAR+Circus+Georgia+41.649729799999996,41.6371768")]),
]

def esc(s): return html.escape(s, quote=False)

def short_addr(a):
    a = re.sub(r",?\s*(Gruzie|Georgia)$", "", a.strip())
    return a

def build_cards(rows):
    cards = {c[0]: [] for c in CATS}
    for cat, key, names, url in CURATED:
        cards[cat].append({"names": names, "note": NOTE[key], "links": [(None, url)], "addr": ""})
    for cat, ids, notekey, nameov in PLACES:
        rs = [rows[i] for i in ids]
        r0 = rs[0]
        if isinstance(nameov, int):
            names = NAME[nameov]
        elif isinstance(nameov, str):
            names = {l: nameov for l in LANGS}
        else:
            names = {l: r0["name"] for l in LANGS}
        links = []
        for r in rs:
            label = short_addr(r["address"]).split(",")[0] if len(rs) > 1 else None
            links.append((label or r["name"], r["maps_url"]))
        addr = short_addr(r0["address"]) if len(rs) == 1 else ""
        if addr.startswith("Adresa v okolí"):
            addr = ""
        cards[cat].append({"names": names, "note": NOTE[notekey] if notekey else None, "links": links, "addr": addr})

    by_cat = {}
    for h in HIGHLIGHTS:
        by_cat.setdefault(h["cat"], []).append({**h, "highlight": True})
    for cat, hl in by_cat.items():
        cards[cat] = hl + cards[cat]
    return cards

def render_highlight(lang, h):
    """Bohatá rozbalovací karta: fotka, štítek, fakta, barevné boxy, mapa(y)."""
    title = esc(h["title"][lang])
    tag = esc(h["tag"][lang])
    photo = h.get("photo")
    out = ['        <details class="place-card">', '          <summary>']
    if photo:
        out.append(f'            <span class="pc-thumb"><img src="../assets/img/places/{photo}" alt="" loading="lazy" width="64" height="64"></span>')
    else:
        out.append(f'            <span class="pc-thumb" aria-hidden="true">{esc(h["tag"][lang])}</span>')
    out.append('            <span class="pc-head">')
    out.append(f'              <span class="pc-title">{title}</span>')
    out.append(f'              <span class="pc-tag">{tag}</span>')
    out.append('            </span>')
    out.append('            <span class="pc-chevron" aria-hidden="true">⌄</span>')
    out.append('          </summary>')
    out.append('          <div class="pc-body">')
    if photo:
        out.append(f'            <img class="pc-photo" src="../assets/img/places/{photo}" alt="{title}" loading="lazy" width="960" height="540">')
        if h.get("credit"):
            credit_txt = f'{CREDIT_LABEL[lang]}: {esc(h["credit"])}, {esc(h["license"])}, Wikimedia Commons'
            out.append(f'            <a class="pc-credit" href="{html.escape(h["credit_url"])}" target="_blank" rel="noopener">{credit_txt}</a>')
    out.append(f'            <p class="pc-lead">{esc(h["lead"][lang])}</p>')
    if h.get("stats"):
        out.append('            <div class="pc-stats">')
        for key, val in h["stats"]:
            v = val[lang] if isinstance(val, dict) else val
            out.append(f'              <div><span class="k">{esc(LBL[key][lang])}</span><span class="v">{esc(v)}</span></div>')
        out.append('            </div>')
    for kind, btitle, btext in h.get("boxes", []):
        out.append(f'            <div class="pc-box {kind}"><span class="pc-box-h">{esc(btitle[lang])}</span>{esc(btext[lang])}</div>')
    out.append('            <div class="pc-maps">')
    for label, url in h["maps"]:
        ltxt = f'{NAV_LABEL[lang]}{" — " + label[lang] if label else ""}'
        out.append(f'              <a href="{html.escape(url)}" target="_blank" rel="noopener">{esc(ltxt)} →</a>')
    out.append('            </div>')
    out.append('          </div>')
    out.append('        </details>')
    return "\n".join(out)

def render_row(lang, card):
    """Jedno místo -> maplink řádek, nebo skupina poboček -> ml-group."""
    if card.get("highlight"):
        return render_highlight(lang, card)
    title = esc(card["names"][lang])
    note = card["note"][lang] if card["note"] else None
    if len(card["links"]) == 1:
        url = html.escape(card["links"][0][1])
        sub_parts = [p for p in [note, card["addr"]] if p]
        sub = esc(" · ".join(sub_parts)) if sub_parts else ""
        label = f'{NAV_LABEL[lang]}: {card["names"][lang]}'
        out = [f'        <a class="maplink" href="{url}" target="_blank" rel="noopener" aria-label="{esc(label)}">']
        out.append('          <span class="ml-text">')
        out.append(f'            <span class="ml-title">{title}</span>')
        if sub:
            out.append(f'            <span class="ml-sub">{sub}</span>')
        out.append('          </span>')
        out.append('          <span class="ml-arrow" aria-hidden="true">›</span>')
        out.append('        </a>')
        return "\n".join(out)
    # skupina poboček
    out = ['        <div class="ml-group">', '          <div class="ml-group-head">',
           f'            <span class="ml-group-title">{title}</span>']
    if note:
        out.append(f'            <div class="ml-group-note">{esc(note)}</div>')
    out.append('          </div>')
    for label, url in card["links"]:
        blabel = f'{NAV_LABEL[lang]}: {label}'
        out.append(f'          <a class="ml-branch" href="{html.escape(url)}" target="_blank" rel="noopener" aria-label="{esc(blabel)}">')
        out.append(f'            <span>{esc(label)}</span>')
        out.append('            <span class="ml-arrow" aria-hidden="true">›</span>')
        out.append('          </a>')
    out.append('        </div>')
    return "\n".join(out)

def ensure_head_body(t, lang):
    """Doplní <body class="tips-page"> a font Barlow Condensed, idempotentně."""
    if 'class="tips-page"' not in t:
        t = t.replace("<body>", '<body class="tips-page">', 1)
    if "Barlow+Condensed" not in t:
        t = t.replace(
            '<link rel="stylesheet" href="../assets/css/style.css">',
            '<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&amp;display=swap" rel="stylesheet">\n'
            '<link rel="stylesheet" href="../assets/css/style.css">',
            1,
        )
    return t

def main():
    with open(CSV, encoding="utf-8-sig") as f:
        rows = {int(r["order"]): r for r in csv.DictReader(f)}
    cards = build_cards(rows)
    total = sum(len(v) for v in cards.values())
    print(f"Karty celkem: {total}")

    for lang in LANGS:
        path = ROOT / "web" / lang / "tips.html"
        t = path.read_text(encoding="utf-8")
        t = ensure_head_body(t, lang)

        out = ['  <!-- PLACES:START (generováno tools/generate_places.py v2) -->']
        out.append('  <nav class="cat-nav">')
        for key, kind, labels in CATS:
            n = len(cards[key])
            out.append(f'    <a href="#cat-{key}">{esc(labels[lang])} <small>({n})</small></a>')
        out.append('  </nav>')

        for idx, (key, kind, labels) in enumerate(CATS, start=1):
            css_kind = KIND_CSS[kind]
            out.append(
                f'\n  <section class="section" id="cat-{key}" '
                f'style="--kind-color:var(--kind-{css_kind}); --kind-soft:var(--kind-{css_kind}-soft);">'
            )
            out.append('    <div class="wrap">')
            out.append(f'      <p class="kicker" style="color:var(--kind-color)">{esc(CAT_LABEL_KICKER[lang])} {idx} · {len(CATS)}</p>')
            out.append('      <div class="chapter-head">')
            out.append('        <span class="dot"></span>')
            out.append(f'        <h2>{esc(labels[lang])}</h2>')
            out.append(f'        <span class="count">{esc(COUNT_PREFIX[lang])} {len(cards[key])}</span>')
            out.append('      </div>')
            out.append('      <div class="ml-list">')
            for card in cards[key]:
                out.append(render_row(lang, card))
            out.append('      </div>')
            out.append('    </div>')
            out.append('  </section>')
        out.append('  <!-- PLACES:END -->')
        block = "\n".join(out)

        if "PLACES:START" in t:
            t = re.sub(r'  <!-- PLACES:START.*?PLACES:END -->', lambda _m: block, t, flags=re.DOTALL)
        else:
            i_img = t.find("sea-1600.webp")
            i_end = t.find("</section>", i_img) + len("</section>")
            i_map_h2 = t.find(">Mapa</h2>") if lang == "cs" else -1
            t = t[:i_end] + "\n\n" + block + "\n" + t[i_end:]
        path.write_text(t, encoding="utf-8")
        print(f"{lang}/tips.html — hotovo")

if __name__ == "__main__":
    sys.exit(main())
