# Geminus API Documentation

This folder contains documentation for all external systems that Geminus integrates with.

## Integrated Systems

| System | Purpose | Auth Method | Status |
|--------|---------|-------------|--------|
| [Geminus Plus](./geminus-plus/) | BIM/Asset management | OAuth2 (Keycloak) + API Key | Active |
| [Ivion](./ivion/) | 360° panorama & POI | JWT Token | Active |
| [Geminus Base](./geminus-base/) | Facility management data | Basic Auth | Active |
| [Geminus Premium](./senslinc/) | IoT sensor data | Bearer Token | Active |
| [Faciliate](./faciliate/) | Desktop FM system (SWG) | JWT (v2 REST API) | Active |
| [Congeria](./congeria/) | Document management | Session-based | Planned |

## Quick Reference

### Geminus Plus API
- **Base URL**: Configured via `GEMINUS_PLUS_API_URL` secret
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

### Geminus Base API
- **Base URL**: Configured via `GEMINUS_BASE_API_URL` secret
- **Primary use**: Work orders, maintenance data
- **Key endpoints**:
  - `GET /workorders` - List work orders
  - `GET /buildings` - Building information

### Geminus Premium API
- **Base URL**: Configured via `GEMINUS_PREMIUM_API_URL` secret
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
| `geminus-plus-query` | Geminus Plus | Read objects with filtering |
| `geminus-plus-create` | Geminus Plus | Create new objects |
| `geminus-plus-update` | Geminus Plus | Update object properties |
| `geminus-plus-sync` | Geminus Plus | Batch sync from Geminus Plus to local DB |
| `ivion-poi` | Ivion | Manage points of interest |
| `geminus-base-query` | Geminus Base | Query work orders |
| `geminus-premium-query` | Geminus Premium | Query sensor data |
| `congeria-sync` | Congeria | Sync documents (planned) |

## Secrets Configuration

All API credentials are stored as Supabase secrets:

```
# Geminus Plus
GEMINUS_PLUS_API_URL
GEMINUS_PLUS_API_KEY
GEMINUS_PLUS_KEYCLOAK_URL
GEMINUS_PLUS_CLIENT_ID
GEMINUS_PLUS_CLIENT_SECRET
GEMINUS_PLUS_USERNAME
GEMINUS_PLUS_PASSWORD

# Ivion
IVION_API_URL
IVION_USERNAME
IVION_PASSWORD
IVION_ACCESS_TOKEN
IVION_REFRESH_TOKEN

# Geminus Base
GEMINUS_BASE_API_URL
GEMINUS_BASE_USERNAME
GEMINUS_BASE_PASSWORD

# Geminus Premium
GEMINUS_PREMIUM_API_URL
GEMINUS_PREMIUM_EMAIL
GEMINUS_PREMIUM_PASSWORD

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
│  │geminus-plus-* │  │ivion-poi    │  │geminus-base-query      │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────┘
          │                │                     │
          ▼                ▼                     ▼
    ┌──────────┐     ┌──────────┐          ┌──────────┐
    │ Geminus Plus   │     │  Ivion   │          │Geminus Base │
    │   API    │     │   API    │          │   API    │
    └──────────┘     └──────────┘          └──────────┘
```

## Local Database Tables

Synced data is stored in Supabase tables for fast access:

| Table | Source | Purpose |
|-------|--------|---------|
| `assets` | Geminus Plus | Buildings, floors, rooms, assets |
| `xkt_models` | Geminus Plus | 3D model file metadata |
| `work_orders` | Geminus Base | Maintenance work orders |
| `documents` | Congeria | Document metadata (planned) |

## Adding a New Integration

1. Create Edge Function in `supabase/functions/[system-name]/`
2. Add secrets for authentication
3. Create documentation in `docs/api/[system-name]/`
4. Add sync tables if needed via migration
5. Update this README
