

# Matcha Felanmälan med er-rep.com

## Sammanfattning

Screenshoten visar att er-rep.com och Geminus har **exakt samma falt**. Inga extra falt saknas. Skillnaderna ar visuella och UX-relaterade. Planen nedan justerar Geminus-formularet for att matcha er-rep.com:s utseende och beteende exakt.

## Skillnader att atgarda

| Element | er-rep.com | Geminus idag | Andring |
|---------|-----------|--------------|---------|
| Installation-info | Enkel textrad i en latt ruta: "Installation 000000042 Kaffemaskin K12" | Info-box med ikon och separata rader | Forenkla till en enkel textrad som matchar |
| Felkod | Dropdown/combobox med pil | Vanligt textfalt (Input) | Andra till en combobox/select med fritext-alternativ |
| Hjalp-ikoner | Bla (?) ikon till hoger om varje falt-label | Saknas | Lagga till tooltip-ikoner med hjalp-text for varje falt |
| Rensa-knappar | (x) knapp pa e-post och telefon | Saknas | Lagga till clear-knappar pa dessa falt |
| Foto-knapp | "Ta Bild/Bladdra..." knapp | Bildrutor med drag-and-drop stil | Lagga till en tydlig "Ta Bild/Bladdra..." knapp (behalla aven bildforhandsvisning) |
| Skicka-knapp | "Skicka" utan ikon | "Skicka felanmalan" med Send-ikon | Andra till "Skicka" for att matcha |

## Teknisk plan

### Steg 1: Uppdatera FaultReportForm.tsx

- **Installation-info**: Forenkla fran info-box med ikon till en enkel readonly-liknande textrad: `Installation {number} {assetName}`
- **Felkod**: Byt fran `<Input>` till en `<Combobox>` (baserad pa `cmdk` som redan finns installerat) eller `<Select>` med ett fritext-alternativ. Eftersom felkoderna troligen ar dynamiska/okanda an sa lange, anvands en enkel dropdown med ett "Ovrigt"-alternativ plus fritext-input som fallback
- **Hjalp-ikoner**: Lagg till en `<Tooltip>` med en `<HelpCircle>`-ikon (fran lucide-react) bredvid varje `<FormLabel>`. Tooltip-texterna matchar er-rep.com:s hjalptexter
- **Rensa-knappar**: Lagg till en `<X>`-ikon-knapp inuti e-post- och telefonfalt som rensar faltet nar det har innehall
- **Foto-sektion**: Lagg till en explicit "Ta Bild/Bladdra..."-knapp utover den befintliga bildforhandsvisningen
- **Skicka-knapp**: Andra text fran "Skicka felanmalan" till "Skicka" och ta bort Send-ikonen

### Steg 2: Uppdatera MobileFaultReport.tsx

Samma andringar som ovan, tillampade pa mobilversionen:
- Forenkla installation-info
- Felkod som combobox
- Hjalp-tooltips (anpassade for mobil -- kanske tap-to-show)
- Rensa-knappar pa e-post/telefon
- "Ta Bild/Bladdra..."-knapp
- Skicka-knapptext

### Steg 3: Uppdatera PhotoCapture.tsx

Lagg till en tydlig "Ta Bild/Bladdra..."-knapp med outlined stil, utover den befintliga bildrutnats-forhandsvisningen. Knappen ska synas aven nar inga bilder annu ar tillagda.

### Filer som andras

| Fil | Andring |
|-----|---------|
| `src/components/fault-report/FaultReportForm.tsx` | Alla visuella justeringar (info-bar, felkod-dropdown, hjalpikoner, rensa-knappar, knapptext) |
| `src/components/fault-report/MobileFaultReport.tsx` | Samma andringar for mobilversionen |
| `src/components/fault-report/PhotoCapture.tsx` | Lagg till "Ta Bild/Bladdra..."-knapp |

### Om Felkod-dropdown

Felkod-faltet i er-rep.com verkar vara en dropdown (har en nedatpil). Tva alternativ:

1. **Statisk lista** -- om det finns en fast lista med felkoder kan dessa hardkodas eller hamtas fran databasen
2. **Fritext med dropdown-stil** -- en combobox dar anvandaren kan skriva fritt men faltet ser ut som en dropdown (detta matchar "Ange en matchande felkod"-texten)

Jag rekommenderar alternativ 2 (combobox med fritext) eftersom det matchar placeholder-texten och ger flexibilitet.

