

# Plan: Auto-sync XKT-modeller från Asset+ vid öppning i Native Viewer

## Problem
Native Xeokit-viewern läser XKT-filer enbart från den lokala databasen (`xkt_models`-tabellen + `xkt-models` storage bucket). Om inga modeller är cachade visas ett felmeddelande. Det finns redan en `sync-xkt-building` action i edge function som kan hämta XKT från Asset+ och spara till storage — men viewern anropar den aldrig automatiskt.

## Nuvarande flöde
```text
Användare öppnar byggnad → NativeXeokitViewer → SELECT från xkt_models
                                                    ↓
                                              Inga modeller? → Felmeddelande (stopp)
```

## Nytt flöde
```text
Användare öppnar byggnad → NativeXeokitViewer → SELECT från xkt_models
                                                    ↓
                                              Inga modeller? → Anropa sync-xkt-building
                                                    ↓
                                              Visa "Synkar modeller..." UI
                                                    ↓
                                              Modeller synkade → Ladda in i viewer
                                                    ↓
                                              Fortfarande inga? → Visa felmeddelande
```

## Implementation

### 1. Uppdatera NativeXeokitViewer — auto-sync fallback
**File:** `src/components/viewer/NativeXeokitViewer.tsx`

Ändra logiken vid `models.length === 0`:
- Istället för att visa fel direkt, sätt `phase = 'syncing'` och anropa `supabase.functions.invoke('asset-plus-sync', { body: { action: 'sync-xkt-building', buildingFmGuid } })`
- Vid lyckat svar: hämta modellistan igen från `xkt_models` och ladda in
- Vid misslyckat svar eller fortfarande 0 modeller: visa felmeddelande
- Lägg till `'syncing'` i `LoadPhase` typ
- Lägg till synk-UI med spinner och text "Hämtar 3D-modeller från Asset+..."

### 2. Hantera uppdaterade modeller (staleness check)
**File:** `src/components/viewer/NativeXeokitViewer.tsx`

Även när modeller finns, kontrollera om de kan vara inaktuella:
- Jämför `synced_at` med nuvarande tid — om äldsta modellen > 7 dagar, trigga en bakgrundssynk (icke-blockerande)
- Bakgrundssynken anropar `sync-xkt-building` och om nya modeller hittas, logga det (utan att störa pågående session)

### 3. Uppdatera sync-xkt-building — stöd uppdateringscheck
**File:** `supabase/functions/asset-plus-sync/index.ts`

Lägg till `force: boolean` parameter i `sync-xkt-building`:
- Om `force: true`: ersätt befintliga modeller (upsert med ny data)
- Nuvarande beteende (skippa existerande) behålls som default

### Filer att ändra
- `src/components/viewer/NativeXeokitViewer.tsx` — auto-sync fallback + staleness check
- `supabase/functions/asset-plus-sync/index.ts` — stöd `force` parameter

