

## Plan: Uppdatering — IMDF Export-knapp under Sync-fliken

### Ändring mot tidigare plan

Tidigare plan placerade "Export IMDF"-knappen i `FacilityLandingPage.tsx` (Portfolio). Användaren vill istället ha den i **Sync-fliken** i `ApiSettingsModal.tsx`.

### Placering

Ny `AccordionItem` med `value="imdf-export"` i Sync-fliken, placerad efter BIP Reference Data (sista accordion-item). Innehåller:

- Byggnadsväljare (dropdown med `allBuildings`)
- "Export IMDF"-knapp som anropar `supabase.functions.invoke('imdf-export', { body: { buildingFmGuid } })`
- Status/progress-indikator under export
- Nedladdning av ZIP-fil när klar

### Filer att ändra/skapa

| Fil | Åtgärd |
|-----|--------|
| `supabase/functions/imdf-export/index.ts` | **NY** — edge function (venue, level, unit, anchor GeoJSON → ZIP) |
| `src/components/settings/ApiSettingsModal.tsx` | Ny AccordionItem "IMDF Export" i Sync-fliken |

### Edge function: `imdf-export`

Fas 1 (metadata-only):
1. Hämta byggnad från `building_settings` + `assets` → **venue.geojson**
2. Hämta våningar (`category = 'Level'`) → **level.geojson**
3. Hämta rum (`category = 'Space'`) → **unit.geojson** med rektangulär bounding box-polygon (√area som sida) transformerad till WGS84
4. Hämta inventerade tillgångar med koordinater → **anchor.geojson**
5. **manifest.json** + ZIP-paketering (med `JSZip` eller manuell ZIP i Deno)
6. Returnera ZIP som binary response

### UI i Sync-fliken

```text
┌─────────────────────────────────────┐
│ 📦 IMDF Export                      │
├─────────────────────────────────────┤
│ Export building data as IMDF for    │
│ indoor mapping (Apple Maps etc.)    │
│                                     │
│ Building: [▼ Välj byggnad        ]  │
│                                     │
│ [📥 Export IMDF]  [status text]     │
└─────────────────────────────────────┘
```

