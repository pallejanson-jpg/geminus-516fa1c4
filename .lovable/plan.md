

# Named API Profiles for Multi-Tenant Credential Management

## Problem
You have multiple Asset+ / Senslinc environments with different credentials. Currently, credentials are either global (env vars) or per-building (embedded in `building_settings`). You want to:
1. Define named credential sets ("API Profile 1", "API Profile 2") once
2. Assign any building to a profile instead of duplicating credentials per building
3. Keep the current global credentials as the default profile
4. Create buildings in Geminus first (with correct FMGUID) and link them to a profile

## Solution: API Profiles Table + Profile Picker

### New database table: `api_profiles`

```text
api_profiles
├── id (uuid, PK)
├── name (text) — e.g. "Production", "Customer X Environment"
├── is_default (boolean) — one profile marked as default (uses env vars)
├── assetplus_api_url, assetplus_api_key, assetplus_keycloak_url,
│   assetplus_client_id, assetplus_client_secret,
│   assetplus_username, assetplus_password
├── senslinc_api_url, senslinc_email, senslinc_password
├── fm_access_api_url, fm_access_username, fm_access_password
├── ivion_api_url, ivion_username, ivion_password
├── created_at, updated_at
```

### Link buildings to profiles
Add `api_profile_id (uuid, nullable, FK → api_profiles.id)` column to `building_settings`. When null → use the default profile (current env vars).

### Credential resolution change
Update `_shared/credentials.ts` to:
1. Check `building_settings.api_profile_id`
2. If set → fetch credentials from `api_profiles` row
3. If not → fall back to env vars (same as today)

This replaces the current per-building credential columns in `building_settings` (which can be migrated/deprecated).

## Files to Change

| Action | File | What |
|--------|------|------|
| **Migration** | `supabase/migrations/` | Create `api_profiles` table + add `api_profile_id` to `building_settings` + seed default profile from env vars |
| **Create** | `src/components/settings/ApiProfilesManager.tsx` | CRUD UI for named profiles — name, all credential fields, test buttons |
| **Modify** | `src/components/properties/CreatePropertyDialog.tsx` | Replace inline credential fields with a profile dropdown selector |
| **Modify** | `src/pages/Properties.tsx` | Show profile name badge instead of per-credential badges |
| **Modify** | `supabase/functions/_shared/credentials.ts` | Resolve credentials via `api_profiles` table instead of `building_settings` columns |
| **Modify** | `src/components/settings/ApiSettingsModal.tsx` | Add "API Profiles" tab to settings for managing profiles |

## UI Flow

```text
Settings → API Profiles tab
┌────────────────────────────────────┐
│ API Profiles                       │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ ★ Default (env vars)         │   │  ← auto-created, non-deletable
│ │   Asset+: ✓  Senslinc: ✓    │   │
│ └──────────────────────────────┘   │
│ ┌──────────────────────────────┐   │
│ │ Customer X                   │   │  ← user-created
│ │   Asset+: ✓  Senslinc: ✗    │   │
│ │   [Edit] [Test] [Delete]     │   │
│ └──────────────────────────────┘   │
│                                    │
│ [+ New Profile]                    │
└────────────────────────────────────┘

Properties → Create/Edit Building
┌────────────────────────────────────┐
│ Building Identity                  │
│   FM GUID: [____________]          │
│   Name:    [____________]          │
│                                    │
│ API Profile: [▼ Default        ]   │  ← dropdown instead of credential fields
│              • Default (env vars)  │
│              • Customer X          │
│              + New Profile...      │
└────────────────────────────────────┘
```

## Key Design Decisions
- The "Default" profile is a virtual row that reads from env vars — no secrets stored in DB for it
- Per-building credential columns in `building_settings` are kept temporarily for backward compatibility but the UI stops writing to them
- RLS: admin-only write, authenticated read (credentials are server-side only via edge functions; the frontend only sees profile names)

