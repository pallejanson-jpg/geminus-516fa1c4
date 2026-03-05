

# Plan: System Activation + Viewer Color Fix + Error Analysis

## 1. Systemstöd — Hur aktiveras det för redan synkade byggnader?

### Svar på dina frågor:

**Behöver jag köra om synkning mot Asset+?**
Ja — de nya tabellerna (`systems`, `asset_system`, `asset_external_ids`, `asset_connections`) är tomma. Befintliga byggnader har inga systemrelationer ännu. Men den nuvarande `asset-plus-sync`-koden extraherar inte system — den koden uppdaterades inte i förra steget. Systemextraktion lades till i `ifc-to-xkt` och `acc-sync`, inte i `asset-plus-sync`.

**Behöver jag köra om synkning mot ACC?**
Ja, om byggnaderna importerades via ACC. Den uppdaterade `acc-sync`-koden skapar nu system automatiskt från "System Name"-properties vid synk.

**Praktisk aktivering:**
- **ACC-byggnader**: Kör en ny ACC-sync → systemdata extraheras automatiskt via den uppdaterade `acc-sync`-koden
- **IFC-byggnader**: Ladda upp IFC-filen igen → `ifc-to-xkt` extraherar nu `IfcSystem` och `IfcRelAssignsToGroup`
- **Asset+-byggnader**: Vi behöver lägga till systemextraktion i `asset-plus-sync` edge function också — detta saknas idag

Jag rekommenderar att vi lägger till en knapp "Synka system" i inställningarna som triggar en re-sync specifikt för system, utan att behöva göra en full omsynk.

---

## 2. Färgfix — Rum, fönster, bakgrund i Native Xeokit

### Nuvarande status:
- **`architect-colors.ts`**: Fönster har färg `[0.392, 0.490, 0.541]` — detta ÄR en blågrå ton (#647D8A). Användaren vill INTE ha blå fönster.
- **`SPACE_COLOR`**: `[0.898, 0.894, 0.890]` — neutral grå, INTE röd. Men rum kan se röda ut om arkitektfärger inte appliceras korrekt, eller om filter-panelens auto-color aktiveras.
- **Bakgrund**: NativeViewerShell har redan grå gradient `linear-gradient(180deg, rgb(255,255,255) 0%, rgb(230,230,230) 100%)` — detta är korrekt.

### Ändringar:

**a) Fönster — byt från blågrå till neutral/varm grå**

I `src/lib/architect-colors.ts` OCH `src/hooks/useArchitectViewMode.ts`:
- Ändra `ifcwindow` och `ifcwindowstandardcase` till en neutral varm grå, t.ex. `[0.780, 0.780, 0.760]` (ljus beige-grå, liknande bjälkar)
- Samma ändring i `useArchitectViewMode.ts` `ARCHITECT_COLORS.window`

**b) Rum (IfcSpace) — säkerställ att de aldrig är röda**

- `SPACE_COLOR` är redan grå `[0.898, 0.894, 0.890]` — detta är korrekt
- Verifiera att `ViewerFilterPanel` inte applicerar röd färg som default på spaces
- Lägg till en explicit kontroll i `applyArchitectColors` som säkerställer att spaces alltid får `SPACE_COLOR`

**c) Bakgrund — redan grå, verifiera överallt**

- `NativeViewerShell.tsx` rad 383: redan korrekt grå gradient
- Verifiera att Cesium-viewern inte har annan bakgrund vid BIM-laddning

---

## 3. Native Xeokit överallt + A-modell-prioritet

### Redan implementerat:
- Native Xeokit används överallt via `NativeViewerShell` → `NativeXeokitViewer`
- A-modell-prioritet finns i `NativeXeokitViewer.tsx` rad 323-391
- Preload-prioritering finns i `useXktPreload.ts`

### XKT per-våning-uppdelning:
`xkt-split` edge function finns men skapar "virtuella chunks" (samma fil, metadata per våning). Riktig binär uppdelning är markerad som "Phase 2" och är inte implementerad. Denna funktion anropas aldrig automatiskt — den måste triggas manuellt. Vi behöver verifiera om detta fortfarande ska användas eller om floor-isolation via metaScene räcker.

---

## 4. Felanalys — Edge function-loggar

### Hittade fel:
**`asset-plus-sync`**: `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON` vid `discover3dModelsEndpoint`. Asset+ 3D-modell-endpointen returnerar HTML istället för JSON — troligen en 404/502 som ger en HTML-felsida. Denna hanteras redan som fallback i koden.

### IFC/BIM-to-GLB:
Inga fel hittades i loggarna för `ifc-to-xkt` eller `bim-to-gltf` just nu.

---

## Implementationsplan

### Steg 1: Fixa fönsterfärg
- Ändra `ifcwindow`/`ifcwindowstandardcase` i `architect-colors.ts` och `useArchitectViewMode.ts` till neutral varm grå `[0.780, 0.780, 0.760]`

### Steg 2: Säkerställ att rum aldrig är röda
- Verifiera och förstärk `SPACE_COLOR`-applicering i `applyArchitectColors`
- Lägg till explicit space-reset i `ViewerFilterPanel` cleanup

### Steg 3: Verifiera bakgrund och färgpalett på alla 3D-ställen
- `NativeViewerShell` (redan korrekt)
- `CesiumGlobeView` BIM-rendering
- Split-viewer

### Steg 4: System-sync-knapp (framtida)
- Lägg till en "Synka system"-åtgärd i settings som triggar re-sync med systemextraktion

