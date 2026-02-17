

# ACC 3D-modeller: Realistiska alternativ

## Korrigering: SVF2 Streaming fungerar INTE i xeokit

SVF2 ar Autodesks proprietara format som BARA fungerar med Autodesks egen Viewer (APS/Forge Viewer). Xeokit stodjer XKT, IFC, glTF, OBJ och STL -- men inte SVF2. Mitt tidigare forslag var felaktigt.

## Nuvarande problem

Translationen fastnar pa 99% vid stora RVT-filer. Koden begär bade SVF och OBJ samtidigt, och OBJ-genereringen for stora modeller ar extremt langsam -- troligen orsaken till att det hakar sig.

---

## Tre vagar framat

### Alt A: Optimera nuvarande pipeline (minst arbete)

Andra translation-begaran fran `SVF + OBJ` till bara `SVF2`. SVF2 ar snabbare att generera an SVF. Nar translationen ar klar, ladda ner OBJ-derivatet separat fran manifestet istallet for att begara det som en del av jobbet.

- **Fordel**: Minimal kodandring, behaller xeokit med alla menyer/trad/annotationer
- **Risk**: Stora modeller kan fortfarande ta lang tid att ladda ner som OBJ
- **Arbetsinsats**: Liten (1-2 filer)

### Alt B: Byt till Autodesk APS Viewer for ACC-modeller (rekommenderas)

Byt ut xeokit-canvaset mot Autodesks egen Viewer-komponent ENBART for ACC-sourced modeller. Asset+-modeller fortsatter anvanda xeokit som idag.

- Autodesks Viewer laddar SVF2 direkt -- noll konvertering, noll nedladdning
- Den har egna API:er for trad-navigation, egenskaper, sektionsplan, etc.
- Vi bygger vara befintliga UI-komponenter (toolbar, annotation-panel, issues) ovanpa Autodesks canvas
- **Fordel**: Instant laddning av alla ACC-modeller oavsett storlek
- **Nackdel**: Kraver en hel del arbete att bygga wrapper-komponenter; tva viewer-motorer att underhalla
- **Arbetsinsats**: Stor (ny komponent + wrapper-lager)

### Alt C: Hybrid -- Autodesk Viewer som iframe med kommunikation (snabbast att implementera)

Badda in Autodesks Viewer i en iframe for ACC-modeller och kommunicera via postMessage for val, kameraposition etc.

- **Fordel**: Snabb implementation, zero conversion
- **Nackdel**: Begransad integration med vara menyer; tva separata UI-varldar
- **Arbetsinsats**: Medel

---

## Rekommendation

**Borja med Alt A** (ta bort OBJ fran translationsbegaran) for att se om det loser 99%-problemet. Det ar en enkel andring:

### Steg 1: Andra acc-sync edge function

Byt translationsbegaran fran:
```text
formats: [{ type: "svf", views: ["3d"] }, { type: "obj" }]
```
till:
```text
formats: [{ type: "svf2", views: ["3d"] }]
```

### Steg 2: Uppdatera download-derivative

Nar SVF2-translationen ar klar (100%), extrahera OBJ- eller mesh-data fran SVF2-manifestet och ladda ner individuella geometri-filer.

### Steg 3: Utvardera resultatet

Om SVF2-only translation gar klart snabbt (< 5 min) och nedladdningen fungerar, ar problemet lost. Om stora modeller fortfarande tar for lang tid, ga vidare till Alt B (Autodesk Viewer-komponent).

---

## Tekniska detaljer

### Fil som andras (Alt A)

**supabase/functions/acc-sync/index.ts**
- Rad ~1903-1909: Andra `formats` array till `[{ type: "svf2", views: ["3d"] }]`
- `check-translation` sectionen: Uppdatera manifest-parsning for SVF2-struktur
- `download-derivative` sectionen: Extrahera OBJ/mesh fran SVF2-manifestets derivat-lista

### Databas

Kolumnen `format` i `xkt_models` kan behova nytt varde `svf2-obj` for att skilja fran direkta XKT-filer.

### Ingen andring i viewern

Xeokit laddar OBJ via `OBJLoaderPlugin` som redan finns -- det ar bara *hur* vi far fram OBJ-filen som andras.

