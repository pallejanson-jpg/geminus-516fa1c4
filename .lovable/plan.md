

# Autodesk Construction Cloud (ACC) Integration

## Background

Your app currently fetches building hierarchy data (Buildings, Storeys, Spaces, Assets) from **Asset+** via Keycloak-authenticated REST calls, syncs it to a local database (`assets` table), and builds a Navigator tree from it. This plan adds **Autodesk Construction Cloud** as an alternative/additional data source using the same proven pattern.

## What ACC Offers

ACC provides two key APIs that map directly to your existing data model:

1. **Locations API** -- A tree of location nodes (LBS = Location Breakdown Structure) representing buildings, floors, rooms, zones, etc. This maps to your hierarchy: Building > Building Storey > Space.

2. **Assets API** -- Equipment/items linked to locations and categories. This maps to your "Instance" objects (assets).

Both APIs are well-documented REST endpoints under `https://developer.api.autodesk.com/`.

## Architecture Overview

The integration follows the same hybrid pattern you already use for Asset+:
- A backend function authenticates with Autodesk, fetches data, and upserts it into the local `assets` table
- The frontend remains unchanged -- it reads from the local database via the existing Navigator tree builder

```text
+-------------------+       +---------------------+       +----------------+
|  ACC Locations    |       |  Edge Function      |       |  assets table  |
|  & Assets APIs   | ----> |  acc-sync            | ----> |  (existing)    |
+-------------------+       +---------------------+       +----------------+
                                    |                            |
                            OAuth 2.0 (2-legged)         Navigator Tree
                            via APS                      (unchanged)
```

## Credentials Required

You will need to create an **APS Application** (Autodesk Platform Services) at https://aps.autodesk.com. From there you get:

| Credential | Description |
|---|---|
| APS_CLIENT_ID | Application Client ID |
| APS_CLIENT_SECRET | Application Client Secret |
| ACC_ACCOUNT_ID | Your ACC account (hub) ID |

The 2-legged (Client Credentials) OAuth flow is used since this is a server-to-server sync -- no user login required. You also need to know which ACC **Project ID** to sync from. This can be configured per building or globally.

## API Endpoints We Will Use

### Authentication
- `POST https://developer.api.autodesk.com/authentication/v2/token` -- Get access token (2-legged, Client Credentials grant)

### Account / Projects
- `GET https://developer.api.autodesk.com/construction/admin/v1/accounts/{accountId}/projects` -- List available projects

### Locations (Building hierarchy)
- `GET https://developer.api.autodesk.com/construction/locations/v2/projects/{projectId}/trees/{treeId}/nodes` -- Get all location nodes (the full LBS tree)

### Assets
- `GET https://developer.api.autodesk.com/construction/assets/v2/projects/{projectId}/assets` -- List assets with pagination
- `GET https://developer.api.autodesk.com/construction/assets/v1/projects/{projectId}/categories` -- Get asset categories

## Implementation Plan

### Step 1: Store ACC Credentials as Secrets

Request three secrets from you:
- `APS_CLIENT_ID`
- `APS_CLIENT_SECRET`
- `ACC_ACCOUNT_ID`

These are stored securely as backend secrets (same pattern as your existing Asset+ credentials).

### Step 2: Create `acc-sync` Edge Function

A new backend function `supabase/functions/acc-sync/index.ts` with the following actions:

**`authenticate`** -- Gets a 2-legged OAuth token from APS:
```text
POST /authentication/v2/token
  grant_type=client_credentials
  client_id=...
  client_secret=...
  scope=data:read
```

**`list-projects`** -- Lists ACC projects for the account (used in settings UI to let you pick which project to sync from).

**`sync-locations`** -- Fetches the LBS tree and maps location nodes to the `assets` table:
- Root node -> ignored
- Level 1 nodes (e.g. buildings) -> category = 'Building'
- Level 2 nodes (e.g. floors) -> category = 'Building Storey'
- Level 3+ nodes (e.g. rooms) -> category = 'Space'
- Uses the node `id` as `fm_guid` and `parentId` to set `building_fm_guid` / `level_fm_guid`

**`sync-assets`** -- Fetches ACC assets with pagination and maps them:
- Asset `id` -> `fm_guid`
- Asset `clientAssetId` (Name) -> `name`
- Asset `description` -> stored in `attributes`
- Asset `locationId` -> resolved to `building_fm_guid`, `level_fm_guid`, `in_room_fm_guid` via the location tree
- Asset category name -> `asset_type`
- Category hierarchy -> `category` = 'Instance'

**`check-status`** -- Returns sync state for the ACC data source.

### Step 3: Add ACC Configuration to Settings UI

Add an "Autodesk Construction Cloud" tab/section in the existing API Settings modal (alongside Asset+, FM Access, Congeria, etc.):

- **Connection fields**: APS Client ID, Client Secret (masked), ACC Account ID
- **Project selector**: Dropdown populated by the `list-projects` action
- **Sync buttons**: "Sync Locations" and "Sync Assets" with progress indicators
- **Status display**: Counts of synced buildings/floors/rooms/assets from ACC

Store the selected ACC project ID in a new column on `building_settings` or in a dedicated `acc_settings` key-value store.

### Step 4: Data Mapping Logic

The mapping between ACC and your existing data model:

| ACC Concept | Your Data Model | Table Column |
|---|---|---|
| Location Node (tier 1) | Building | `category = 'Building'` |
| Location Node (tier 2) | Building Storey | `category = 'Building Storey'` |
| Location Node (tier 3+) | Space | `category = 'Space'` |
| Asset | Instance | `category = 'Instance'` |
| Node ID | fm_guid | `fm_guid` |
| Node name | commonName | `common_name` |
| Asset clientAssetId | name | `name` |
| Asset locationId | Resolved to room | `in_room_fm_guid` |

All records synced from ACC will have a source marker in the `attributes` JSONB column: `{ "source": "acc", "acc_project_id": "..." }` so they can be distinguished from Asset+ data.

### Step 5: Database Changes

Minimal changes needed since the existing `assets` table already supports all required fields. We may add:

- A new `asset_sync_state` entry with `subtree_id = 'acc-locations'` and `subtree_id = 'acc-assets'` to track ACC sync status independently
- Optional: A simple `acc_config` table or key-value rows in `asset_plus_endpoint_cache` to store the selected ACC project ID

### Step 6: Frontend -- No Changes Needed

The Navigator tree, AssetsView, InventoryForm, and all other components read from the local `assets` table. Since ACC data will be written to the same table with compatible categories, the entire UI works automatically:
- Buildings appear in the portfolio view
- Floors appear in the floor switcher
- Rooms appear in room selectors
- Assets appear in inventory lists

## What You Need to Provide

1. **APS Application credentials** -- Create an app at https://aps.autodesk.com, note the Client ID and Secret
2. **ACC Account ID** -- Found in your ACC admin settings (the hub ID, usually prefixed with `b.`)
3. **Confirmation of which project(s)** to sync from (the edge function can list available projects for you to choose)

## Risks and Considerations

- **ACC requires an Autodesk Docs subscription** for API access to AEC Data Model and Locations
- **Location tree depth may vary** -- some projects use 2 tiers, others up to 20. The mapping logic will handle this flexibly
- **Data overlap** -- if you sync the same building from both Asset+ and ACC, there could be duplicates. The source marker in `attributes` helps manage this
- **Rate limits** -- ACC APIs have rate limits (varies by endpoint). The sync function will include retry logic with backoff

