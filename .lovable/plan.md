

## Plan: FM Access Sync Section in Settings

### Current State

The Sync tab in `ApiSettingsModal.tsx` has three working `SyncProgressCard` components for Asset+ (Structure, Assets, XKT), followed by a **placeholder** FM Access section (lines 2862-2889) with a disabled "Starta synk" button and a "Kommer snart" badge. The CRUD service (`fm-access-service.ts`) is already functional.

### Changes

#### File: `src/components/settings/ApiSettingsModal.tsx`

Replace the placeholder FM Access section (lines 2862-2889) with a functional sync section that:

1. **Tests connection first** — reuses `handleTestFmAccessConnection` to verify API is reachable
2. **Fetches hierarchy** — calls `getFmAccessHierarchy` for each building that has a `building_fm_guid` in `building_settings`
3. **Pushes local assets** — iterates local assets with `building_fm_guid` set and calls `pushAssetToFmAccess` for each
4. **Shows progress** — counts of objects pushed, connection status, and errors

**New state variables:**
- `isSyncingFmAccess` / `fmAccessSyncResult` for tracking sync progress
- `fmAccessObjectCount` for displaying synced count

**New handler: `handleSyncToFmAccess`**
- Tests connection
- Queries local `assets` table for assets with a `building_fm_guid` matching known FM Access buildings (Småviken, Centralstationen, Labradorgatan)
- Loops through assets, calling `pushAssetToFmAccess` for each
- Reports success/failure count via toast

**UI structure** — matches the existing card pattern:
```text
┌─────────────────────────────────────────┐
│ 🏢 FM Access                           │
│ Push lokala objekt till FM Access       │
│                                         │
│ Anslutning: ✅ OK / ❌ Ej ansluten     │
│ Lokala objekt med FM-koppling: 42       │
│                                         │
│ [Testa anslutning]  [Synka till FMA →]  │
│                                         │
│ Senaste synk: 2026-02-24 14:30          │
│ Resultat: 38 lyckades, 4 misslyckades   │
└─────────────────────────────────────────┘
```

The section is placed after the Asset+ total summary (line 2860) and before the existing Senslinc section, keeping it visually grouped but clearly separated with its own heading.

### Files to Modify

| File | Changes |
|---|---|
| `src/components/settings/ApiSettingsModal.tsx` | Replace placeholder FM Access sync section with functional push-to-FMA UI, add state + handler |

