

# Analys: IFC-uppladdningsflödet för Jönköping

## Hur flödet fungerar idag

Koden i `CreateBuildingPanel.tsx` (rad 259) avgör konverteringsväg baserat på filstorlek:

```text
const useDirectBrowser = fileSizeMB > 20;
```

| Filstorlek | Väg | Vad händer |
|---|---|---|
| **≤ 20 MB** | Edge function (`ifc-to-xkt`) | Servern laddar ner IFC, konverterar till XKT, sparar. Snabbt men begränsat av Deno-minnesgränsen (~150 MB RAM). |
| **> 20 MB** | Browser-baserad konvertering | Filen konverteras i din webbläsare med `web-ifc` + `@xeokit/xeokit-convert`. Resultatet laddas upp till storage. |

**XKT-workern** är ett helt separat spår. Den pollar `conversion_jobs` med status `pending` och konverterar dem till **per-storey tiles** (en .xkt per våningsplan). Men den körs bara om du startar den manuellt.

## Vad som hände med din 275 MB-fil

1. Filen är > 20 MB → **browser-konvertering** startades.
2. En `conversion_jobs`-rad skapades (status `pending`), men browser-konverteringen uppdaterar den direkt till `processing` → `done`.
3. Det finns **en XKT-fil** i databasen: `ifc-1773229820361` (skapad via browser).
4. Byggnaden "Jönköping Science Tower" finns som `Building` i `assets`, men har **inga Building Storey eller Space**-rader. Hierarkin populerades aldrig.

## Status på alla Jönköping-jobb

| Jobb | Modell | Status | Problem |
|---|---|---|---|
| `6773e761` | A-40-V-100 | **pending** | Nyss skapat, väntar (XKT-worker eller edge fn har inte rört det) |
| `5bcf9e6a` | V-54-V-100 | **pending** | Samma — väntar |
| `8aa4a53c` | A-40-V-100 | **pending** (33%) | XKT-worker försökte 3 gånger men fastnade på storey 1/18. Kraschade upprepat. |
| `bb401f42` | A-40-V-200 | **processing** (30%) | Edge function fastnade vid IFC-parsning (23.7 MB, precis över gränsen) |
| 3 st äldre | A-40-V-200 | **processing** (30%) | Samma — edge function timeout |

**Svar på dina frågor:**

### Behöver du köra XKT-workern?
- **Nej, inte alltid.** Filer > 20 MB konverteras redan i browsern. Du får en fungerande XKT-fil.
- **Ja, om du vill ha per-storey tiles** (en XKT per våningsplan). Det ger snabbare laddning i viewern — 15 MB per våning istället för en 120 MB-fil.
- XKT-workern är ett **tillval för prestanda**, inte ett krav.

### Är XKT-workern snabbare?
- **Ja**, för stora filer (100+ MB). Node.js med 4-8 GB RAM hanterar dem robustare än en webbläsarflik.
- Browser-konverteringen fungerar men kan krascha/bli långsam på 275 MB-filer.

### Gick senaste importen bra?
- **Delvis.** En XKT-fil skapades via browsern — 3D-modellen syns i viewern.
- **Men:** Inga våningsplan eller rum populerades i databasen (den nya pipeline-koden vi just skrev har inte deployats/körts ännu).
- XKT-workern har **inte lyckats** med något Jönköping-jobb — den krashade på A-40-V-100 (fastnade vid storey 1/18, försökte 3 gånger).

## Rekommendation

Nuvarande process bör förenklas. Förslag:

1. **Browser-konvertering** hanterar allt (redan implementerat, fungerar för 275 MB).
2. **XKT-workern** ska vara opt-in för att göra per-storey-tiling efteråt — inte en nödvändig del av importen.
3. **Hierarchy-population** (den pipeline vi just kodade) behöver deployas och köras för att Jönköping ska få våningsplan/rum i Navigator.
4. De 6 stuckade `processing`/`pending`-jobben bör rensas upp.

Vill du att jag rensar de gamla jobben och kör hierarchy-population för Jönköping?

