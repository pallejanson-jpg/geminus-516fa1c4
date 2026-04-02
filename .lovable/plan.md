

# Sync API Profile fields with Asset+ tab

## Problem
The API Profiles form for Asset+ credentials is missing the **`audience`** field that exists in the main Asset+ settings tab. The Asset+ tab has 8 fields:

| Asset+ Tab (ConfigState) | API Profiles form | Match? |
|---|---|---|
| API URL | assetplus_api_url | Yes |
| API Key | assetplus_api_key | Yes |
| Keycloak URL | assetplus_keycloak_url | Yes |
| Client ID | assetplus_client_id | Yes |
| Client Secret | assetplus_client_secret | Yes |
| Username | assetplus_username | Yes |
| Password | assetplus_password | Yes |
| **Audience** | — | **Missing** |

## Fix

### 1. Database migration
Add `assetplus_audience text` column to `api_profiles` table.

### 2. `ApiProfilesManager.tsx`
- Add `assetplus_audience` to `ApiProfile` interface, `ProfileForm`, and `EMPTY_FORM`
- Add the "Audience" input field in the Asset+ accordion section (default placeholder: `asset-api`)

### 3. `credentials.ts`
- Add `audience` to `AssetPlusCredentials` interface
- Resolve it from `profile.assetplus_audience` or fall back to env var / default `"asset-api"`

### 4. Verify edge functions
Check that `getAccessToken()` in sync/query functions uses `audience` from credentials (currently most hardcode or use env vars — this ensures profile-level override works).

## Technical details
- Single migration: `ALTER TABLE api_profiles ADD COLUMN assetplus_audience text;`
- Three files edited: `ApiProfilesManager.tsx`, `credentials.ts`, plus migration
- No breaking changes — null audience falls back to existing default

