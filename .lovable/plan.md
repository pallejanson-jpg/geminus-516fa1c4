

# Plan: Properties Page as Building Configuration Hub

## Current State

The `Properties.tsx` page is currently a static mockup with hardcoded data. It needs to become a functional page that:
1. Lists real buildings from the database (`building_settings` + `assets` where category = 'Building')
2. Allows creating new building entries with FM GUID and custom API credentials
3. Allows configuring per-building Asset+ and Senslinc credential overrides

## What Changes

### 1. Database Migration

Add 10 credential override columns to `building_settings`:

```
assetplus_api_url, assetplus_api_key, assetplus_keycloak_url,
assetplus_client_id, assetplus_client_secret, assetplus_username, assetplus_password,
senslinc_api_url, senslinc_email, senslinc_password
```

All nullable — NULL means "use global credentials".

### 2. Rewrite `Properties.tsx` to be functional

- Fetch buildings from `building_settings` joined with `assets` (category = 'Building')
- Each card shows: name, FM GUID, address, area, sync status indicator, whether custom credentials are configured
- "Lägg till fastighet" button opens a dialog/sheet

### 3. Create Property Dialog (`CreatePropertyDialog.tsx`)

A sheet/dialog with two sections:

**Section 1 — Building Identity**
- FM GUID (text input — the key that links to Asset+)
- Name
- Address
- Coordinates (lat/lng)

On save: upserts into `building_settings` with the given `fm_guid`.

**Section 2 — Custom API Credentials (Accordion, collapsed by default)**

Two sub-sections:

**Asset+ Override:**
- API URL, API Key, Keycloak URL, Client ID, Client Secret, Username, Password

**Senslinc Override:**
- API URL, Email, Password

A "Test Connection" button for each that calls the existing edge functions with the override credentials.

### 4. Property Detail / Edit

Clicking a property card (or "Redigera" in dropdown) opens the same dialog pre-filled, allowing credential editing.

### 5. Shared Credential Resolver (`supabase/functions/_shared/credentials.ts`)

```typescript
export async function getCredentials(supabase, buildingFmGuid, system: 'assetplus' | 'senslinc') {
  // 1. Check building_settings for overrides
  // 2. Fall back to Deno.env.get() globals
}
```

### 6. Update Edge Functions

Modify these to use the credential resolver when `buildingFmGuid` is provided:
- `asset-plus-sync/index.ts`
- `asset-plus-query/index.ts`
- `senslinc-query/index.ts`

The change is small — replace direct `Deno.env.get()` calls with `getCredentials()` at the top of the handler.

## Files

| Action | File |
|--------|------|
| Migration | Add 10 columns to `building_settings` |
| Rewrite | `src/pages/Properties.tsx` — functional with real data |
| Create | `src/components/properties/CreatePropertyDialog.tsx` |
| Create | `supabase/functions/_shared/credentials.ts` |
| Modify | `supabase/functions/asset-plus-sync/index.ts` — use resolver |
| Modify | `supabase/functions/asset-plus-query/index.ts` — use resolver |
| Modify | `supabase/functions/senslinc-query/index.ts` — use resolver |

## Flow

1. Admin opens Properties page → sees all buildings
2. Clicks "Lägg till fastighet" → enters FM GUID + name + optional credentials
3. Saves → `building_settings` row created
4. Triggers sync for that building → edge function detects override credentials → uses them
5. Building data appears in the platform alongside existing buildings

