
# Plan: Fixa "Koordinater saknas" i Split View

## Sammanfattning

Split View visar "Koordinater saknas" eftersom **byggnaden saknar lat/lng-värden** i databasen. Synkroniseringen kräver dessa för att transformera koordinater mellan 3D (lokal BIM) och 360° (geografisk).

## Nuläge

| Fält | Värde |
|------|-------|
| `fm_guid` | 9baa7a3a-717d-4fcb-8718-0f5ca618b28a |
| `ivion_site_id` | 3373717251911143 ✓ |
| `latitude` | **null** ❌ |
| `longitude` | **null** ❌ |
| `rotation` | 0 |

## Lösning (två delar)

### Del 1: Sätt in koordinater för Centralstationen

Stockholm Centralstations koordinater:
- **Latitude**: 59.330364
- **Longitude**: 18.060124
- **Rotation**: 0 (kan justeras senare om synk-riktningen är fel)

Detta görs via en databasuppdatering.

### Del 2: Skapa UI för att konfigurera koordinater

Användare behöver ett sätt att ställa in lat/lng och rotation för byggnader. Detta ska läggas till i byggnadsinställningarna.

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| **Databas** | Uppdatera `building_settings` med lat/lng för Centralstationen |
| `src/components/settings/ApiSettingsModal.tsx` | Lägg till fält för lat/lng och rotation (eller skapa ny komponent) |
| `src/hooks/useBuildingSettings.ts` | Eventuellt utöka med `updateRotation` |

## Implementation

### Steg 1: Databasuppdatering
```sql
UPDATE building_settings 
SET latitude = 59.330364, longitude = 18.060124, rotation = 0
WHERE fm_guid = '9baa7a3a-717d-4fcb-8718-0f5ca618b28a';
```

### Steg 2: UI för koordinatinställningar

Lägg till ett expanderbart avsnitt i byggnadsinställningarna med:
- Textfält för Latitude (decimal)
- Textfält för Longitude (decimal)
- Slider eller textfält för Rotation (0-360 grader)
- "Hämta från karta"-knapp (valfritt - öppnar karta för att välja punkt)

```text
┌─────────────────────────────────────────────┐
│ Byggnadsinställningar                       │
├─────────────────────────────────────────────┤
│ 📍 Georeferering (för 3D/360° synk)        │
│                                             │
│ Latitude:  [59.330364________]              │
│ Longitude: [18.060124________]              │
│ Rotation:  [0°_____] (grader relativt norr) │
│                                             │
│ [Spara koordinater]                         │
└─────────────────────────────────────────────┘
```

## Dataflöde efter implementation

```text
building_settings (DB)
    │
    ├─ latitude: 59.330364
    ├─ longitude: 18.060124
    └─ rotation: 0
          │
          ▼
SplitViewer.tsx
    │
    ├─ buildingData.origin = { lat, lng, rotation }
    ├─ hasOrigin = true ✓
    └─ syncEnabled = true
          │
          ▼
    ┌─────────────┐         ┌─────────────┐
    │ 3D Viewer   │◄───────►│ 360° View   │
    │ (BIM local) │  SYNK   │ (Geo coord) │
    └─────────────┘         └─────────────┘
```

## Prioritering

| Prio | Åtgärd | Beskrivning |
|------|--------|-------------|
| 1 | Databasuppdatering | Sätt in Centralstationens koordinater (omedelbar fix) |
| 2 | UI för koordinater | Skapa inställningsfält för framtida byggnader |

## Acceptanskriterier

1. ✓ Varningen "Koordinater saknas" försvinner för Centralstationen
2. ✓ Sync ON-knappen blir aktiv
3. ✓ Navigering i 360° uppdaterar 3D-vyn
4. ✓ Användare kan konfigurera koordinater för andra byggnader via UI
