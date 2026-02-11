

# Fix: Utoka retry-tiden for Autodesk-oversattning

## Problem

Autodesk Model Derivative-oversattningen av stora Revit-filer (som 12011A_2023.rvt) tar 5-15 minuter. Koden ger upp efter 2 minuter per fas (12 forsok x 10 sekunder), totalt max 4 minuter. Resultatet ar meddelandet "Forsok igen".

Loggarna visar att oversattningen fortfarande ar "pending" nar klienten ger upp:
- acc-svf-to-gltf anropas var 10:e sekund i 2 minuter, alltid "Fetching manifest... pending"
- acc-sync (download-derivative) samma monster

## Atgarder

### 1. Oka retry-granser i `src/services/acc-xkt-converter.ts`

Tre platser behover andras:

**a) `doDownloadAndConvert` (rad 481)**
- Fran: 12 forsok (2 min)
- Till: 36 forsok (6 min)

**b) `tryServerConversion` (rad 388)**
- Fran: 12 forsok (2 min)
- Till: 36 forsok (6 min)

Totalt ger detta upp till 12 minuter vantetid, vilket tacker de flesta oversattningar.

**c) Forbattra statusmeddelanden**
Visa uppskattad tid kvar istallet for bara forsoksnummer, t.ex.:
```
"Vantar pa oversattning fran Autodesk... (ca X min kvar)"
```

### 2. Undvik dubbelpolling

Just nu pollar bade `doDownloadAndConvert` OCH `tryServerConversion` mot samma Autodesk-jobb i serie. Om download-fasen redan vantat 6 minuter och oversattningen fortfarande ar pending, sa ar det meningslost att tryServerConversion vantar ytterligare 6 minuter.

Losning: om `doDownloadAndConvert` returnerar pending efter alla retries, propagera detta direkt som slutstatus istallet for att falla igenom till `tryServerConversion`.

### Sammanfattning

```text
Fil: src/services/acc-xkt-converter.ts
  - rad 481: 12 -> 36 retries i doDownloadAndConvert
  - rad 388: 12 -> 36 retries i tryServerConversion  
  - rad ~520: Om download-pending efter alla retries, returnera failed direkt (skippa server-conversion retry)
  - Battre statusmeddelanden med tidsuppskattning
```

