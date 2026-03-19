

## Plan: Radera byggnad + Jobbkö-vy

Två funktioner: (1) Radera-knapp i byggnadsväljaren, (2) En jobbkö-sektion som visar alla conversion_jobs för vald byggnad med möjlighet att se status, loggar och radera fastnade jobb.

---

### 1. Radera byggnad — knapp i byggnadsväljaren

**`CreateBuildingPanel.tsx`** — Lägg till en röd "Radera"-ikon (Trash2) bredvid building-selectorn, synlig bara när en byggnad är vald. Klick öppnar en AlertDialog med bekräftelse. Vid "Radera" anropas edge function.

**`asset-plus-delete/index.ts`** — Ny action `deleteBuilding`:
- Hämta alla assets med `building_fm_guid = X` + byggnaden själv
- Batcha synkade (is_local=false) → Asset+ ExpireObject (50 per loop)  
- DELETE alla från `assets` (service role)
- DELETE relaterad data: `building_settings`, `saved_views`, `navigation_graphs`, `asset_external_ids`, `asset_system`, `fm_access_drawings`, `fm_access_documents`, `fm_access_dou`, `conversion_jobs`, `xkt_models`
- DELETE filer från storage buckets: `xkt-models`, `ifc-uploads` (paths med building guid)

**`asset-plus-service.ts`** — Ny `deleteBuilding(buildingFmGuid)` funktion.

**DB-migrering** — Lägg till DELETE RLS-policy på `building_settings` för admins (saknas idag).

---

### 2. Jobbkö — conversion_jobs för vald byggnad

**`CreateBuildingPanel.tsx`** — Ny AccordionItem "Conversion Jobs" som visar alla `conversion_jobs` för vald byggnad:
- Hämta `conversion_jobs` med `building_fm_guid = X`, sortera senaste först
- Visa per jobb: modellnamn, status (badge: pending/processing/done/failed), progress, skapad tid, felmeddelande
- "Visa loggar" expanderar log_messages
- "Radera jobb" knapp (admin) — tar bort jobbet från tabellen
- "Återställ" knapp för stuck jobs (status=processing >2h) — sätter tillbaka till pending
- Auto-refresh var 10:e sekund om något jobb är pending/processing

---

### Filändringar

| Fil | Ändring |
|-----|---------|
| `supabase/functions/asset-plus-delete/index.ts` | Ny `deleteBuilding` action |
| `src/services/asset-plus-service.ts` | Ny `deleteBuilding()` |
| `src/components/settings/CreateBuildingPanel.tsx` | Radera-knapp med AlertDialog + ny Accordion "Conversion Jobs" |
| DB-migrering | DELETE policy på `building_settings` + DELETE policy på `conversion_jobs` för admins |

