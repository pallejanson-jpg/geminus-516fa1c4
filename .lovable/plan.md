
# Plan: Ivion Integration - Fas 6: Skapa Asset från Ivion POI

## Sammanfattning

Implementera ett flöde där användaren kan skapa en asset i Geminus (Lovable) direkt inifrån Ivion när de skapar en POI. Detta kräver:
1. En dedikerad webbsida/endpoint i Geminus som kan bäddas in i Ivions POI-dialog
2. Backend-funktion för att hämta POI-data och skapa assets
3. Kommunikation mellan Ivion och Geminus (postMessage eller URL-parametrar)

---

## Arkitekturval: Iframe-embed i Ivion

Baserat på bilden och Ivions kapaciteter finns det ett sätt att lägga till en "Geminus"-flik i Ivions POI-dialog:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                              IVION                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        Create POI Dialog                             │  │
│  │  ┌────────────────┬────────────────┬───────────────────┐            │  │
│  │  │     Basic      │   Advanced     │     Geminus       │ ◄─ CUSTOM  │  │
│  │  └────────────────┴────────────────┴───────────────────┘   TAB/LINK │  │
│  │                                                                      │  │
│  │  ┌───────────────────────────────────────────────────────────────┐  │  │
│  │  │                                                               │  │  │
│  │  │    IFRAME: geminus.app/ivion-create?siteId=X&imageId=Y       │  │  │
│  │  │                                                               │  │  │
│  │  │    ┌────────────────────────────────────┐                    │  │  │
│  │  │    │  Registrera ny tillgång           │                    │  │  │
│  │  │    │                                    │                    │  │  │
│  │  │    │  Namn: _______________            │                    │  │  │
│  │  │    │  Kategori: [v]                    │                    │  │  │
│  │  │    │  Symbol: [v]                      │                    │  │  │
│  │  │    │  Byggnad: (auto-fylld)            │                    │  │  │
│  │  │    │                                    │                    │  │  │
│  │  │    │  [Avbryt]  [Spara]                │                    │  │  │
│  │  │    └────────────────────────────────────┘                    │  │  │
│  │  │                                                               │  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  │                               [Cancel]  [Save]                       │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Alternativa tillvägagångssätt

1. **Iframe-embed (Rekommenderat)**: Ivion stöder custom HTML i POI-beskrivningar. Vi kan använda en länk/knapp i Ivion som öppnar Geminus-formuläret i en sidopanel eller popup.

2. **Popup-fönster**: Användaren klickar på en knapp i Ivion som öppnar ett nytt fönster med Geminus-formuläret, pre-populerat med position och site-data.

3. **Webhook-baserat**: Ivion skapar POI först, sedan pollar/webhookar Geminus för nya POIs att importera.

**Vald strategi**: Kombinera **popup-fönster** med **webhook/polling** för en robust lösning som fungerar oavsett hur användaren skapar POI.

---

## Implementationsplan

### Fas 6.1: Databas - Nya kolumner för Ivion-koppling

Lägg till kolumner i `assets`-tabellen för att spåra Ivion POI-kopplingar:

```sql
ALTER TABLE assets ADD COLUMN ivion_poi_id INTEGER;
ALTER TABLE assets ADD COLUMN ivion_site_id TEXT;
ALTER TABLE assets ADD COLUMN ivion_synced_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN ivion_image_id INTEGER;
```

| Kolumn | Typ | Syfte |
|--------|-----|-------|
| `ivion_poi_id` | INTEGER | Ivion POI ID (för deep-linking tillbaka) |
| `ivion_site_id` | TEXT | Vilken Ivion-site denna asset tillhör |
| `ivion_synced_at` | TIMESTAMPTZ | Senaste synk med Ivion |
| `ivion_image_id` | INTEGER | Ivion panorama-bild ID (för position) |

### Fas 6.2: Edge Function - `ivion-poi`

Skapa en ny edge function som hanterar Ivion API-kommunikation:

```text
supabase/functions/ivion-poi/index.ts

Stödda actions:
├── get-token          → Autentisera mot Ivion API
├── get-pois           → Hämta alla POIs för en site  
├── get-poi            → Hämta en specifik POI
├── create-poi         → Skapa POI i Ivion (från asset)
├── update-poi         → Uppdatera POI i Ivion
├── delete-poi         → Ta bort POI från Ivion
├── import-poi         → Importera POI till Geminus-asset
└── sync-all           → Bulk-synk alla POIs för en site
```

**Autentisering** (Ivion API):
```typescript
const getIvionToken = async () => {
  const response = await fetch(`${IVION_API_URL}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(IVION_USERNAME)}&password=${encodeURIComponent(IVION_PASSWORD)}`
  });
  return response.json();
};
```

### Fas 6.3: Ny sida - Ivion Create Asset

Skapa en dedikerad sida för att skapa assets från Ivion-kontext:

```text
src/pages/IvionCreate.tsx

Route: /ivion-create

URL-parametrar:
├── siteId       → Ivion site ID
├── imageId      → Panorama-bild ID (position)
├── x, y, z      → Koordinater (om tillgängliga)
├── fov          → Field of view
├── orientation  → Kamera-orientering (quaternion)
└── poiId        → Om vi länkar till befintlig POI
```

**Flöde:**
1. Användaren är i Ivion och klickar på en "Skapa i Geminus"-länk
2. Länken öppnar `/ivion-create?siteId=X&imageId=Y&x=10&y=20&z=1`
3. Sidan visar samma formulär som `InventoryForm` men:
   - Byggnad auto-väljs baserat på `ivion_site_id` → `building_settings.fm_guid`
   - Koordinater pre-fylls från URL-parametrar
   - Efter spara: skapa/uppdatera POI i Ivion och spara `ivion_poi_id`

### Fas 6.4: Ivion Custom Integration

För att lägga till "Geminus"-knappen i Ivion finns flera alternativ:

**Alternativ A: POI Custom Data med länk**
När man skapar en POI i Ivion kan man inkludera en länk i beskrivningen:
```html
<a href="https://geminus.app/ivion-create?siteId=123&imageId=456" target="_blank">
  Registrera i Geminus
</a>
```

**Alternativ B: Ivion Frontend API Customization**
Om ni har tillgång till Ivions Frontend API kan ni:
```javascript
// I Ivion custom script
ivionApi.poi.on('create', (poiData) => {
  // Öppna Geminus-formulär med POI-data
  window.open(`https://geminus.app/ivion-create?` + new URLSearchParams({
    siteId: poiData.siteId,
    imageId: poiData.imageId,
    x: poiData.location.x,
    y: poiData.location.y,
    z: poiData.location.z
  }));
});
```

**Alternativ C: Separat synk-process**
Skapa POIs i Ivion som vanligt, sedan:
1. "Importera från Ivion"-knapp i Geminus settings
2. Hämtar alla nya POIs och skapar assets

### Fas 6.5: Settings UI - Ivion API-konfiguration

Lägg till Ivion API-inställningar i `ApiSettingsModal`:

```text
Ivion-sektionen:
├── API URL: https://customer.ivion.navvis.com
├── Username: admin@company.com  
├── Password: ••••••••
├── [Testa anslutning]
└── [Synka POIs från Ivion]
```

**Nya Supabase Secrets:**
- `IVION_API_URL`
- `IVION_USERNAME`
- `IVION_PASSWORD`

### Fas 6.6: Import-flöde från Ivion

Skapa ett import-flöde som:
1. Hämtar alla POIs från Ivion site
2. Matchar mot `ivion_site_id` i `building_settings`
3. Skapar assets för POIs som inte redan finns (matcha på `ivion_poi_id`)
4. Sparar koordinater och metadata

```typescript
// Importera POIs från Ivion
const importPoisFromIvion = async (siteId: string, buildingFmGuid: string) => {
  // 1. Hämta alla POIs från Ivion
  const pois = await ivionApi.getPois(siteId);
  
  // 2. Filtrera bort redan importerade
  const existingPoiIds = await getExistingPoiIds(buildingFmGuid);
  const newPois = pois.filter(p => !existingPoiIds.includes(p.id));
  
  // 3. Skapa assets för varje ny POI
  for (const poi of newPois) {
    await createAssetFromPoi(poi, buildingFmGuid);
  }
};
```

---

## Fil-ändringar

| Fil | Ändring |
|-----|---------|
| `supabase/migrations/*.sql` | Nya kolumner: `ivion_poi_id`, `ivion_site_id`, `ivion_synced_at`, `ivion_image_id` |
| `supabase/functions/ivion-poi/index.ts` | NY: Edge function för Ivion REST API |
| `src/pages/IvionCreate.tsx` | NY: Dedikerad sida för asset-skapande från Ivion |
| `src/App.tsx` | Lägg till route `/ivion-create` |
| `src/components/inventory/InventoryForm.tsx` | Utöka med stöd för Ivion-kontext (koordinater, POI-ID) |
| `src/components/settings/ApiSettingsModal.tsx` | Lägg till Ivion API-konfiguration och import-knapp |

---

## Sekvensdiagram: Skapa Asset från Ivion

```text
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌─────────┐     ┌────────┐
│  User   │     │  Ivion  │     │ Geminus  │     │  Edge   │     │Supabase│
│         │     │         │     │  (React) │     │Function │     │   DB   │
└────┬────┘     └────┬────┘     └────┬─────┘     └────┬────┘     └───┬────┘
     │               │               │                │              │
     │  Skapa POI    │               │                │              │
     │──────────────>│               │                │              │
     │               │               │                │              │
     │  Klicka       │               │                │              │
     │  "Geminus"    │               │                │              │
     │──────────────>│               │                │              │
     │               │               │                │              │
     │               │   Popup/Tab   │                │              │
     │               │   med params  │                │              │
     │               │──────────────>│                │              │
     │               │               │                │              │
     │               │               │  Fyll formulär │              │
     │<──────────────│──────────────>│                │              │
     │               │               │                │              │
     │  Klicka Spara │               │                │              │
     │──────────────>│──────────────>│                │              │
     │               │               │                │              │
     │               │               │ Spara asset    │              │
     │               │               │───────────────>│  INSERT      │
     │               │               │                │─────────────>│
     │               │               │                │              │
     │               │               │ Skapa POI      │              │
     │               │               │ i Ivion        │              │
     │               │               │───────────────>│              │
     │               │               │                │──────>Ivion  │
     │               │               │                │              │
     │               │               │ Uppdatera      │              │
     │               │               │ ivion_poi_id   │              │
     │               │               │───────────────>│  UPDATE      │
     │               │               │                │─────────────>│
     │               │               │                │              │
     │               │               │  Success!      │              │
     │<──────────────│<──────────────│<───────────────│<─────────────│
     │               │               │                │              │
```

---

## Användargränssnitt

### IvionCreate-sidan

```text
┌───────────────────────────────────────────────────────┐
│  Geminus - Registrera tillgång från Ivion            │
│───────────────────────────────────────────────────────│
│                                                       │
│  📍 Position från Ivion                              │
│  ┌─────────────────────────────────────────────────┐ │
│  │ X: 10.523   Y: 20.341   Z: 1.200               │ │
│  │ Panorama: #456  Site: Centralstationen         │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Namn / Beteckning *                                 │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Brandsläckare BS-001                           │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Kategori *                                          │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 🔥 Brandsläckare                            ▼ │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Symbol *                                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 🧯 Brandsläckare CO2                        ▼ │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Byggnad * (auto-vald)                               │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 🏢 Centralstationen                         ▼ │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────┐  ┌─────────────────────────────┐│
│  │     Avbryt      │  │    Spara & Länka till Ivion ││
│  └─────────────────┘  └─────────────────────────────┘│
└───────────────────────────────────────────────────────┘
```

### Ivion Import-sektion i Settings

```text
┌───────────────────────────────────────────────────────┐
│  ⚡ Ivion Integration                                 │
│───────────────────────────────────────────────────────│
│                                                       │
│  API URL                                             │
│  ┌─────────────────────────────────────────────────┐ │
│  │ https://swg.iv.navvis.com                      │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Användarnamn                                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │ admin@company.com                              │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Lösenord                                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │ ••••••••                                       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────┐  ┌─────────────────────────────┐│
│  │ Testa anslutning│  │ Importera POIs från Ivion  ││
│  └─────────────────┘  └─────────────────────────────┘│
│                                                       │
│  Status: ✅ 12 POIs importerade (2026-01-28)         │
└───────────────────────────────────────────────────────┘
```

---

## Tekniska detaljer

### Ivion POI-struktur

```typescript
interface IvionPoi {
  id: number;
  titles: Record<string, string>;        // { "sv": "Brandsläckare" }
  descriptions: Record<string, string>;  // { "sv": "<p>Beskrivning</p>" }
  location: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number }; // Quaternion
  poiType: { id: number };
  pointOfView: {
    imageId: number;
    location: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    fov: number;
  };
  customData?: string;  // JSON-sträng för att spara fm_guid
  importance: number;
  icon?: string;
}
```

### Mapping Ivion POI → Geminus Asset

```typescript
const createAssetFromIvionPoi = (poi: IvionPoi, buildingFmGuid: string) => ({
  fm_guid: crypto.randomUUID(),
  name: poi.titles['sv'] || poi.titles['en'] || 'Unnamed',
  category: 'Instance',
  asset_type: mapPoiTypeToAssetType(poi.poiType.id),
  building_fm_guid: buildingFmGuid,
  coordinate_x: poi.location.x,
  coordinate_y: poi.location.y,
  coordinate_z: poi.location.z,
  ivion_poi_id: poi.id,
  ivion_site_id: siteId,
  ivion_image_id: poi.pointOfView?.imageId,
  ivion_synced_at: new Date().toISOString(),
  is_local: true,
  created_in_model: false,
  annotation_placed: true,  // Har position från Ivion
  attributes: {
    ivionDescription: poi.descriptions['sv'],
    ivionOrientation: poi.orientation,
    // ...
  }
});
```

---

## Prioriterad implementation

1. **Databas**: Lägg till Ivion-kolumner i assets-tabellen
2. **Secrets**: Be användaren lägga till IVION_API_URL, IVION_USERNAME, IVION_PASSWORD
3. **Edge function**: Implementera `ivion-poi` med auth och POI CRUD
4. **IvionCreate-sida**: Skapa dedikerad sida för asset-skapande från Ivion
5. **Settings UI**: Lägg till Ivion-konfiguration och import-funktion
6. **InventoryForm**: Utöka med stöd för Ivion-kontext

---

## Beroenden och förutsättningar

| Beroende | Status |
|----------|--------|
| Ivion REST API-access | Kräver credentials |
| `building_settings.ivion_site_id` | Finns redan |
| Supabase Edge Functions | Aktivt |
| Ivion Frontend API (valfritt) | För djupare integration |

---

## Nästa steg efter godkännande

1. Skapa databasmigration med nya kolumner
2. Be om Ivion API-credentials (secrets)
3. Implementera edge function `ivion-poi`
4. Skapa `/ivion-create` sidan
5. Uppdatera settings med Ivion-konfiguration
