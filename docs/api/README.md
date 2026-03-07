# Geminus API Documentation

This folder contains documentation for all external systems that Geminus integrates with.

## Integrated Systems

| System | Purpose | Auth Method | Status |
|--------|---------|-------------|--------|
| [Asset+](./asset-plus/) | BIM/Asset management | OAuth2 (Keycloak) + API Key | Active |
| [Ivion](./ivion/) | 360° panorama & POI | JWT Token | Active |
| [FM Access](./fm-access/) | Facility management data | Basic Auth | Active |
| [Senslinc](./senslinc/) | IoT sensor data | Bearer Token | Active |
| [Faciliate](./faciliate/) | Desktop FM system (SWG) | JWT (v2 REST API) | Active |
| [Congeria](./congeria/) | Document management | Session-based | Planned |

## Quick Reference

### Asset+ API
- **Base URL**: Configured via `ASSET_PLUS_API_URL` secret
- **Primary use**: Syncing building/asset data, property updates
- **Key endpoints**:
  - `POST /PublishDataServiceGetMerged` - Read objects
  - `POST /AddObject` / `AddObjectList` - Create objects
  - `POST /UpdateBimObjectsPropertiesData` - Update properties
  - `POST /UpsertRelationships` - Move objects
  - `POST /ExpireObject` - Soft delete

### Ivion API
- **Base URL**: Configured via `IVION_API_URL` secret
- **Primary use**: 360° image management, POI creation
- **Key endpoints**:
  - `GET /sites` - List sites
  - `POST /poi` - Create point of interest

### FM Access API
- **Base URL**: Configured via `FM_ACCESS_API_URL` secret
- **Primary use**: Work orders, maintenance data
- **Key endpoints**:
  - `GET /workorders` - List work orders
  - `GET /buildings` - Building information

### Senslinc API
- **Base URL**: Configured via `SENSLINC_API_URL` secret
- **Primary use**: Real-time sensor readings
- **Key endpoints**:
  - `GET /sensors` - List sensors
  - `GET /readings` - Historical readings

## Edge Functions

All API calls are proxied through Supabase Edge Functions to:
1. Keep API credentials secure (never exposed to browser)
2. Handle authentication token refresh
3. Provide consistent error handling
4. Enable caching where appropriate

| Edge Function | System | Purpose |
|--------------|--------|---------|
| `asset-plus-query` | Asset+ | Read objects with filtering |
| `asset-plus-create` | Asset+ | Create new objects |
| `asset-plus-update` | Asset+ | Update object properties |
| `asset-plus-sync` | Asset+ | Batch sync from Asset+ to local DB |
| `ivion-poi` | Ivion | Manage points of interest |
| `fm-access-query` | FM Access | Query work orders |
| `senslinc-query` | Senslinc | Query sensor data |
| `congeria-sync` | Congeria | Sync documents (planned) |

## Secrets Configuration

All API credentials are stored as Supabase secrets:

```
# Asset+
ASSET_PLUS_API_URL
ASSET_PLUS_API_KEY
ASSET_PLUS_KEYCLOAK_URL
ASSET_PLUS_CLIENT_ID
ASSET_PLUS_CLIENT_SECRET
ASSET_PLUS_USERNAME
ASSET_PLUS_PASSWORD

# Ivion
IVION_API_URL
IVION_USERNAME
IVION_PASSWORD
IVION_ACCESS_TOKEN
IVION_REFRESH_TOKEN

# FM Access
FM_ACCESS_API_URL
FM_ACCESS_USERNAME
FM_ACCESS_PASSWORD

# Senslinc
SENSLINC_API_URL
SENSLINC_EMAIL
SENSLINC_PASSWORD

# Congeria (planned)
CONGERIA_USERNAME
CONGERIA_PASSWORD
```

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Geminus Frontend                        │
│                      (React + Vite)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Supabase Edge Functions                    │
│                   (Deno runtime)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │asset-plus-* │  │ivion-poi    │  │fm-access-query      │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────┘
          │                │                     │
          ▼                ▼                     ▼
    ┌──────────┐     ┌──────────┐          ┌──────────┐
    │ Asset+   │     │  Ivion   │          │FM Access │
    │   API    │     │   API    │          │   API    │
    └──────────┘     └──────────┘          └──────────┘
```

## Local Database Tables

Synced data is stored in Supabase tables for fast access:

| Table | Source | Purpose |
|-------|--------|---------|
| `assets` | Asset+ | Buildings, floors, rooms, assets |
| `xkt_models` | Asset+ | 3D model file metadata |
| `work_orders` | FM Access | Maintenance work orders |
| `documents` | Congeria | Document metadata (planned) |

## Adding a New Integration

1. Create Edge Function in `supabase/functions/[system-name]/`
2. Add secrets for authentication
3. Create documentation in `docs/api/[system-name]/`
4. Add sync tables if needed via migration
5. Update this README
