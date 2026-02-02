# Ivion API Integration

Ivion provides 360° panorama imagery and point-of-interest (POI) management for indoor navigation.

## Overview

Ivion organizes data into:
- **Sites** - A building or location
- **Datasets** - Collections of 360° images (typically per-floor scans)
- **Images** - Individual 360° panoramas
- **POIs** - Points of interest linked to images

## Authentication

Ivion uses JWT-based authentication with refresh tokens:

```
POST {IVION_API_URL}/auth/login
{
  "username": "{IVION_USERNAME}",
  "password": "{IVION_PASSWORD}"
}

Response:
{
  "accessToken": "...",
  "refreshToken": "..."
}
```

Access tokens expire after ~15 minutes. Use the refresh endpoint:

```
POST {IVION_API_URL}/auth/refresh
{
  "refreshToken": "{stored-refresh-token}"
}
```

## Key Endpoints

### Sites

```
GET /sites
GET /sites/{siteId}
```

### Datasets

```
GET /sites/{siteId}/datasets
GET /datasets/{datasetId}
```

### Images

```
GET /datasets/{datasetId}/images
GET /images/{imageId}
```

### Points of Interest

```
GET /sites/{siteId}/pois
POST /pois
PUT /pois/{poiId}
DELETE /pois/{poiId}
```

#### Create POI

```json
{
  "name": "Fire Extinguisher FE-001",
  "siteId": "site-uuid",
  "imageId": 12345,
  "position": {
    "x": 1.5,
    "y": 0.5,
    "z": 2.0
  },
  "metadata": {
    "assetFmGuid": "asset-uuid",
    "category": "safety"
  }
}
```

## Geminus Integration

### Building → Site Mapping

Each building in Geminus can be linked to an Ivion site via `building_settings.ivion_site_id`.

### Asset → POI Synchronization

Assets with 3D coordinates can be synced to Ivion as POIs:

1. User places asset in 3D viewer
2. Coordinates stored in `assets.coordinate_x/y/z`
3. Sync creates POI at corresponding Ivion position
4. POI ID stored in `assets.ivion_poi_id`

### Edge Functions

| Function | Purpose |
|----------|---------|
| `ivion-poi` | Create/update/delete POIs |

## Data Model

```
Ivion Site (1) ─────────── (1) Geminus Building
     │
     ├── Dataset (floor scan)
     │       │
     │       └── Image (360° panorama)
     │
     └── POI ──────────── Geminus Asset
```

## Secrets

```
IVION_API_URL
IVION_USERNAME
IVION_PASSWORD
IVION_ACCESS_TOKEN
IVION_REFRESH_TOKEN
```
