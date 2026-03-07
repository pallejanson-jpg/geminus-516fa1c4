

## Plan: Uppdaterad Sync-strategi för FM Access — Dokument, Ritningar & DoU

### Bakgrund

FM Access-hierarkin (Byggnad/Plan/Rum/Objekt) behöver **inte** synkas — den finns redan via Asset+. Det som saknas för Gunnars prestanda är snabb åtkomst till:

1. **Ritningar** — metadata (namn, typ, våning) för snabb sökning
2. **Dokument** — metadata + textinnehåll för semantisk sökning via `document_chunks`
3. **DoU (Drift och Underhåll)** — instruktioner kopplade till objekt/system

FMGUID är alltid nyckeln för koppling.

### Vad som ändras från tidigare plan

| Tidigare plan | Uppdaterat |
|---------------|------------|
| Synka hierarki (Fastighet→Rum) | **Utgår** — finns i `assets`-tabellen |
| Synka allt via FM Access | Fokus: ritningar, dokument, DoU |
| Bred FM Access-sync | Smalare: bara metadata + textinnehåll |

### Implementation

#### 1. Nya databastabeller

**`fm_access_drawings`**
- `id` uuid PK
- `building_fm_guid` text NOT NULL (nyckel)
- `drawing_id` text
- `object_id` text
- `name` text
- `class_name` text
- `floor_name` text
- `synced_at` timestamptz
- RLS: authenticated read, service role write

**`fm_access_documents`**
- `id` uuid PK
- `building_fm_guid` text NOT NULL
- `document_id` text
- `object_id` text
- `name` text
- `file_name` text
- `class_name` text
- `synced_at` timestamptz
- RLS: authenticated read, service role write

**`fm_access_dou`** (Drift & Underhåll)
- `id` uuid PK
- `object_fm_guid` text NOT NULL (kopplat till objekt/system)
- `building_fm_guid` text
- `title` text
- `content` text
- `doc_type` text (instruction, schedule, checklist)
- `synced_at` timestamptz
- RLS: authenticated read, service role write

#### 2. Edge function: `fm-access-sync`

Ny edge function som:
- Anropar `fm-access-query` internt med `get-drawings` och `get-documents` per byggnad
- Upsert till `fm_access_drawings` och `fm_access_documents`
- Indexerar textinnehåll (dokumentbeskrivningar, DoU-instruktioner) till `document_chunks` med `source = 'fm_access'`
- Actions: `sync-drawings`, `sync-documents`, `sync-dou`, `sync-all`
- Kräver `building_fm_guid` som parameter

#### 3. Uppdatera Gunnar med lokalt sökverktyg

Nytt verktyg i `gunnar-chat/index.ts`:

**`search_fm_access_local`**
- Söker i `fm_access_drawings`, `fm_access_documents`, `fm_access_dou` via SQL
- Söker i `document_chunks` (source = 'fm_access') för semantisk sökning
- Behåller befintliga live-verktyg (`fm_access_search_objects` etc.) för realtidsdata

#### 4. Sync-knapp i inställningar

Lägg till "Synka FM Access-dokument" i `ApiSettingsModal.tsx`:
- Visa senaste synk-tidpunkt
- Progress-indikator
- Per byggnad eller alla byggnader

### Filer att skapa/ändra

| Fil | Åtgärd |
|-----|--------|
| Migration SQL | 3 nya tabeller |
| `supabase/functions/fm-access-sync/index.ts` | Ny |
| `supabase/config.toml` | Lägg till function config |
| `supabase/functions/gunnar-chat/index.ts` | Nytt `search_fm_access_local` verktyg |
| `src/components/settings/ApiSettingsModal.tsx` | Sync-knapp |

### Secrets
Inga nya — återanvänder befintliga `FM_ACCESS_*` credentials.

