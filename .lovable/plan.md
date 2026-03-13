

## Problem: Worker kraschar — försöker öppna .xkt-filer med IFC-parsern

### Orsak

Alla 6 jobb har `source_type: 'xkt'` och `source_bucket: 'xkt-models'` — korrekt i databasen. Men din lokala `worker.mjs` kör tydligen en äldre version som **inte har dispatch-logiken** (`processXktJob` vs `processIfcJob`). Loggarna visar att den anropar `ifcApi.OpenModel()` på `.xkt`-binärfiler, vilket kraschar web-ifc WASM.

Dessutom: `processXktJob` i nuvarande `docs/conversion-worker/worker.mjs` gör egentligen ingenting användbart — den verifierar bara att xkt_models-rader redan finns, men den populerar inte hierarki (storeys/spaces) från XKT-filerna.

### Plan

**Uppdatera `docs/conversion-worker/worker.mjs`** med robust XKT-jobbhantering:

1. **`processXktJob`** — för `source_type === 'xkt'`:
   - Ladda ner XKT-filen
   - Markera jobbet som klart direkt (XKT-filen är redan konverterad)
   - Skapa/verifiera `xkt_models`-rad via `/complete`
   - Skippa all IFC-parsing

2. **`processIfcJob`** — oförändrad, bara för `source_type === 'ifc'`

3. **Lägg till fil-extension-guard** i `processJob`:
   - Om filen slutar på `.xkt`, tvinga `processXktJob` oavsett `source_type`
   - Förhindrar att .xkt-filer någonsin skickas till IFC-parsern

4. **Förbättra felhantering** i `processIfcJob`:
   - Wrappa `ifcApi.OpenModel()` med try/catch för tydligare felmeddelande
   - Logga filstorlek och första bytes för diagnostik

### Teknisk ändring

**`docs/conversion-worker/worker.mjs`**:
- `processXktJob`: Förenkla till download → `/complete` med tile-metadata
- `processJob`: Lägg till extension-guard (`.xkt` → `processXktJob`)
- `processIfcJob`: Bättre error-handling kring `OpenModel`

Ingen ändring i edge functions eller frontend — bara worker-skriptet.

