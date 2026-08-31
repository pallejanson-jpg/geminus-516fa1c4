# IFC Federation App

En helt fristående app för IFC-federationspipelinen (se
[`docs/plans/ifc-federation-plan.md`](../docs/plans/ifc-federation-plan.md))
och för IDS-validering + BCF-rapportering (se
[`docs/plans/ids-validation-plan.md`](../docs/plans/ids-validation-plan.md)).
Körs idag lokalt; avsedd att flyttas till Render senare (se README:s sista
avsnitt).

## Extra beroende: Python (för IDS-validering)

Utöver Node behöver `.venv`/systemets Python ha `ifcopenshell` och
`ifctester` installerat:

```bash
python -m pip install ifcopenshell ifctester
```

Detta används bara av IDS-valideringssteget (`ifc-federation/ids-validator.js`,
som anropar `ifctester` som subprocess) — resten av appen är ren Node och
kräver inget Python alls. Regelbiblioteket ligger i
[`../ifc-federation/ids-rules/`](../ifc-federation/ids-rules) — en delad,
Geminus-underhållen samling `.ids`-filer (beslut: inte kundspecifika
uppladdningar i v1, se planen för resonemang). Verktyg för att skriva egna
regler: [blenderbim.org/ifctester](https://blenderbim.org/ifctester/) (samma
ekosystem, ingen installation) eller
[IDS-Light Editor](https://github.com/louistrue/ids-light-editor)
(självhostbar, skriv i YAML/JSON istället för rå XML).

Backend återanvänder den redan testade pipeline-koden i
[`../ifc-federation/`](../ifc-federation) oförändrad — Phase 1 (Geminus Plus-uppslag),
Phase 2 (arkitektmodell-fallback), Phase 4 (matchningsmatris), Phase 5
(global FMGUID-validering) och Phase 7 (skriv tillbaka/export).

**Phase 6 (3D-viewer, xeokit) är nu porterad** från huvudappens
`FederationViewer.tsx`/`FederationWorkspace.tsx` — [`client/src/FederationViewer.tsx`](client/src/FederationViewer.tsx),
omskriven mot denna apps vanliga CSS istället för Tailwind/shadcn, i övrigt
identisk logik (samma xeokit-SDK-bootstrap, samma per-disciplin-färgläggning,
samma fokus/tona-ner kopplat till matrisen via hover). **Kräver dock
konverterade `.xkt`-filer för att visa något** — den här appen har ingen
IFC→XKT-konvertering ännu (huvudappen har en, `ifc-to-xkt`, som Supabase
edge function). Att portera viewern och att portera konverteringssteget är
två separata jobb; bara det förra är gjort. Tills konverteringen finns
visar viewer-sektionen ett tydligt "inga modeller ännu"-läge istället för
att krascha eller låtsas fungera.

## Köra lokalt

Kräver samma `.env` som huvudappen (`GEMINUS_PLUS_*`-variablerna), en nivå upp.

Två processer, i varsitt terminalfönster:

```bash
# Terminal 1 — backend (API på port 4500)
cd ifc-federation-app
npm install
node --env-file=../.env server.js
```

```bash
# Terminal 2 — frontend (UI på port 5180, proxyr /api mot 4500)
cd ifc-federation-app/client
npm install
npm run dev
```

Öppna http://localhost:5180.

## Flöde

1. Ange byggnads-ID (FMGUID eller namn) om byggnaden redan finns i Geminus
   Plus, och klicka **Kontrollera byggnad** för att direkt se om den hittas
   (och hur många våningar den redan har) innan du laddar upp något. Om
   byggnaden hittas används dess våningsnamn/FMGUID som facit automatiskt —
   en samtidigt uppladdad arkitektmodell blir då bara en disciplin bland
   andra, inte master. Hittas den inte (eller lämnas fältet tomt): ladda upp
   en arkitektmodell, som då blir facit istället.
2. Ladda upp en eller flera disciplinmodeller (namnge varje rad, t.ex. "El",
   "VVS").
3. Välj hur befintliga objekt-FMGUID (rum, tillgångar) ska hanteras:
   standard är att behålla dem som de är och bara åtgärda saknade/dubbla —
   kryssrutan "Generera om alla objekt-FMGUID" tvingar istället fram ett nytt
   FMGUID för varje objekt, oavsett vad det redan hade.
4. Klicka **Analysera** — en progressbar visar verklig, live status från
   servern (uppladdning, tolkning, matchning, validering — inte en fejkad
   animation) medan matchningsmatris + FMGUID-valideringsstatus tas fram.
5. Justera eventuella förslag via rullistorna, tilldela omatchade våningar
   manuellt.
6. Klicka **Bekräfta mappning**.
7. Klicka **Exportera korrigerade IFC-filer** — laddar ner en zip med alla
   filer, namn/FMGUID skrivna enligt bekräftad mappning och alla objekt-
   FMGUID validerade/genererade enligt valet i steg 3.

### Om progressbaren

Byggd på riktiga mätpunkter, inte en tidsbaserad animation: uppladdningen
rapporterar verklig byte-för-byte-status (via XHR), och serverns bearbetning
(tolkning av arkitektmodellens våningar, uppbyggnad av matchningsmatrisen,
FMGUID-validering) pollas live från en bakgrundsjobb-status-endpoint. Detta
krävde en riktig fix: Node.js är enkeltrådigt, så den ursprungliga,
helt synkrona radgenomgången i parsern blockerade hela event-loopen och
gjorde att servern inte ens kunde svara på "hur går det?"-frågor förrän
hela jobbet var klart. Parsningsfunktionerna i `../ifc-federation/` lämnar
nu kontrollen tillbaka till event-loopen ungefär 100 gånger per fil
(`await setImmediate()`), oavsett filstorlek — bekräftat i praktiken mot en
289 MB-fil (4,18 miljoner rader): servern förblir nu responsiv och
progressen rör sig genom hela den ~90 sekunder långa bearbetningen, istället
för att frysa helt som innan fixen.

## Känd begränsning inför flytt till Render

Varje uppladdad fils fulla textinnehåll hålls i en in-memory-session
(`sessions`-Map i `server.js`) under hela analysens livstid — samma
tillvägagångssätt som redan är verifierat lokalt mot riktiga 276 MB-filer.
Fungerar bra för en person som kör detta på sin egen dator. En delad,
alltid-igång Render-tjänst med flera samtidiga användare kommer så
småningom behöva disk-baserade eller strömmade sessioner istället, annars
växer minnesanvändningen obegränsat över samtidiga analyser.

## Nästa steg mot Render

- Byt `sessions`-Map mot något som överlever en omstart (t.ex. temporära
  filer på disk + en TTL-städning) om fler än en person ska använda
  tjänsten samtidigt.
- Sätt `PORT` via miljövariabel (redan stödd: `process.env.PORT`).
- Bygg klienten (`npm run build` i `client/`) och låt Express serva
  `client/dist` som statiska filer i produktion, så hela appen blir en
  enda Render-tjänst istället för två separata processer.
