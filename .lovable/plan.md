## Root cause summary

The build errors fall into four independent buckets — none are related to the `geminus-ai` chat fix from the previous turn.

### 1. Missing `geminus_base_*` DB schema (majority of errors)

Code queries columns/tables that don't exist in the database:
- `building_settings.geminus_base_building_guid`
- `api_profiles.geminus_base_api_url`, `geminus_base_username`, `geminus_base_password`
- tables `geminus_base_documents` and `geminus_base_dou`

Supabase's generated types therefore return `SelectQueryError`, which cascades into all the `Property 'X' does not exist on SelectQueryError` errors across `FacilityLandingPage`, `ApiSettingsModal`, `GeoreferencingSettings`, `useBuildingViewerData`, `useGeminusBaseApi`, and `UniversalPropertiesDialog`.

**Fix:** add a migration that creates the missing columns/tables (with GRANTs + RLS), so types regenerate and the queries become valid.

```sql
ALTER TABLE public.building_settings
  ADD COLUMN IF NOT EXISTS geminus_base_building_guid text;

ALTER TABLE public.api_profiles
  ADD COLUMN IF NOT EXISTS geminus_base_api_url text,
  ADD COLUMN IF NOT EXISTS geminus_base_username text,
  ADD COLUMN IF NOT EXISTS geminus_base_password text;

CREATE TABLE public.geminus_base_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  -- (other columns inferred from usage)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.geminus_base_dou (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_fm_guid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- + GRANTs + RLS for both new tables
```

### 2. `NativeViewerShellProps` missing two props

`MobileViewerPage.tsx` and `UnifiedViewer.tsx` pass `modelFilterFmGuid` and `modelFilterCategory`, but the interface in `NativeViewerShell.tsx` doesn't declare them.

**Fix:** add the two optional props to `NativeViewerShellProps` and forward them to the downstream viewer (no behavioral change beyond making the existing callsites type-check).

### 3. `useSectionPlaneClipping.ts` — use-before-declare

`uniqueStoreys` is referenced on lines 460/463/467 but declared on line 505.

**Fix:** move the `const uniqueStoreys = …` declaration above the fallback block that consumes it.

### 4. `vite.config.ts` — `data` is `unknown`

`const data = await tokenRes.json()` is typed as `unknown` under strict TS, and `data.access_token` then errors.

**Fix:** type the parse: `const data = (await tokenRes.json()) as { access_token: string }`.

---

## Question before I implement

The `geminus_base_*` columns/tables are missing in the DB but referenced widely in the code. I see two ways forward — please pick:

- **A. Add the missing schema** (migration above). This keeps the Geminus Base integration UI/code working as written. I'll need to pick reasonable column sets for the two new tables based on how the code reads them.
- **B. Remove/stub the Geminus Base code paths** (treat the feature as not-yet-deployed). Faster, smaller diff, but disables that UI until the schema lands.

I'll fix #2–#4 either way.