

# Analys & Plan: CRUD-flöde, FM Access-data i UI, och 2D Viewer-integration

## Nuläge — Vad fungerar idag

### CRUD mot Asset+
| Operation | Status | Implementerat i |
|-----------|--------|-----------------|
| **Create** (push lokal → A+) | Fungerar | `syncAssetToAssetPlus()` → `asset-plus-create` edge fn |
| **Read** (sync A+ → Geminus) | Fungerar | `asset-plus-sync` edge fn → `assets`-tabell |
| **Update** (Geminus → A+) | Fungerar | `updateAssetProperties()` → `asset-plus-update` edge fn |
| **Delete** (Geminus → A+ expire) | Fungerar | `deleteAssets()` → `asset-plus-delete` edge fn |

### CRUD mot FM Access
| Operation | Status | Problem |
|-----------|--------|---------|
| **Create** (push → FMA) | Fungerar | `syncAssetWithFmAccess()` / `ensureFmAccessHierarchy()` |
| **Read** (hämta hierarki) | Fungerar | `getHierarchy`, `getObject` via `fm-access-query` |
| **Update** (push properties) | Fungerar | `pushPropertyChangesToFmAccess()` anropas vid spara i Properties |
| **Delete** | **SAKNAS** | `deleteFmAccessObject()` finns i servicen men **anropas aldrig** |

### ACC → Geminus
| Operation | Status |
|-----------|--------|
| **Import** (ACC → lokal DB) | Fungerar via `acc-to-assetplus` och IFC-pipeline |
| **Push till A+** | Fungerar (samma som lokal → A+) |
| **Push till FMA** | Samma flöde som ovan |

---

## Identifierade luckor

### 1. Delete slår inte igenom till FM Access
`UniversalPropertiesDialog.handleDelete()` (rad 728-747) anropar **bara** `deleteAssets()` (Asset+ expire + lokal delete). FM Access-objektet lever kvar.

**Fix**: Efter lyckad `deleteAssets()`, anropa `deleteFmAccessObject(guid)` för varje borttaget objekt (best-effort, som vi redan gör med property-push).

### 2. FM Access-data (DOU, dokument) visas inte i Geminus UI
Data synkas till `fm_access_dou`, `fm_access_documents`, `fm_access_drawings` — men **bara** exponeras via:
- `FmAccessDocuments.tsx` (ritningar/dokument per byggnad i FMA Native-vyn)
- Gunnar AI (via `document_chunks` semantic search)

**Saknas**: Inget sätt att se DOU-instruktioner (drift- och underhållsinformation) direkt kopplat till ett objekt i Properties-dialogen eller i objektpanelen.

### 3. FM Access 2D Viewer som grafiklager
FMA 2D Viewer bäddas redan in via `FmAccess2DPanel.tsx` (iframe). Den har:
- PDF-ritning som bakgrund
- Vektorgrafik-overlay (utrymmen, objekt)
- Click-events som propageras via `postMessage`

**Symbolplacering via FMA API**: FMA har ett grafik-API (`/graphics`) för att placera symboler på ritningar. Det stöder inte realtidsplacering via deras iframe-klient — det kräver API-anrop för att skapa/uppdatera grafiska objekt på ritningar. Det är möjligt men kräver ny edge function-logik.

---

## Plan

### Fas 1: Komplettera Delete-flödet (liten insats)

**Fil: `src/components/common/UniversalPropertiesDialog.tsx`**
- I `handleDelete()` (rad 728-747): efter lyckad `deleteAssets()`, loopa igenom raderade GUIDs och anropa `deleteFmAccessObject(guid)` med best-effort (catch + console.warn).

### Fas 2: Visa FM Access DOU-data i Properties (medel insats)

**Fil: `src/components/common/UniversalPropertiesDialog.tsx`**
- Lägg till en ny sektion "Drift & Underhåll" (DOU) som hämtar data från `fm_access_dou`-tabellen baserat på objektets `fm_guid`.
- Visa titel + innehåll i ett collapsible-block under de befintliga egenskapssektionerna.
- Hämta via enkel Supabase-query: `supabase.from('fm_access_dou').select('*').eq('object_fm_guid', fmGuid)`.

### Fas 3: Visa FM Access Documents kopplat till objekt (medel insats)

**Fil: `src/components/common/UniversalPropertiesDialog.tsx`**
- Lägg till en "Dokument"-sektion som hämtar från `fm_access_documents` baserat på `building_fm_guid`.
- Alternativt flytta `FmAccessDocuments`-komponenten så att den kan renderas inline i Properties-dialogen.

### Fas 4: FM Access symbolplacering via API (stor insats, utredning)

Det här kräver:
1. Ny edge function `fm-access-graphics` som anropar FMA:s grafik-API för att skapa/uppdatera symbolobjekt på ritningar.
2. Mappning mellan Geminus `annotation_symbols` och FMA:s symbolformat.
3. Realtidsuppdatering av iframe-vyn efter placering (troligtvis via `postMessage` reload-kommando).

**Rekommendation**: Parkera detta tills vi har bekräftat att FMA:s grafik-API stöder det vi behöver. Det är ett separat utvecklingsprojekt.

### Fas 5: FMA 2D Viewer som alternativ till egen heatmap (utredning)

FMA:s 2D-viewer har kraftfull vektorgrafik men är begränsad till iframe-integration. Vi kan **inte** styra dess rendering programmatiskt (färga rum, visa heatmaps) — det kräver FMA-interna konfigurationer. Vår egen heatmap-logik i xeokit ger mer kontroll.

**Rekommendation**: Fortsätt använda xeokit för rumsvisualisering. FMA 2D bäddas in för ritningsvisning och dokumentåtkomst, inte som visualiseringsmotor.

---

## Sammanfattning av kodändringar

| Fil | Ändring | Prioritet |
|-----|---------|-----------|
| `UniversalPropertiesDialog.tsx` | Anropa `deleteFmAccessObject` i `handleDelete` | Hög |
| `UniversalPropertiesDialog.tsx` | Ny DOU-sektion (hämta `fm_access_dou` per objekt) | Medel |
| `UniversalPropertiesDialog.tsx` | Ny dokument-sektion (hämta `fm_access_documents`) | Medel |
| Ny edge fn `fm-access-graphics` | Symbolplacering via FMA API | Låg (utredning) |

