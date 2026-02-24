# FM Access (Tessel HDC) API Integration

## Overview
FM Access uses the Tessel HDC API platform hosted at `landlord.bim.cloud`. It provides 2D floor plan viewing, drawings, and document management.

## Authentication

### Step 1: Get OAuth2 Token
Token is obtained from Keycloak using `password` grant type.

```
POST {FM_ACCESS_TOKEN_URL}
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id={FM_ACCESS_CLIENT_ID}&username={FM_ACCESS_USERNAME}&password={FM_ACCESS_PASSWORD}
```

### Step 2: Get Version ID
The system version ID is required as a header for most API calls.

```
GET {FM_ACCESS_API_URL}/api/systeminfo/json
X-Authorization: Bearer {token}
```

Response contains `defaultVersion.versionId` which is used in subsequent requests.

### Step 3: Authenticated API Calls
All API calls require two custom headers:

| Header | Value | Description |
|--------|-------|-------------|
| `X-Authorization` | `Bearer {token}` | **Not** standard `Authorization` header |
| `X-Hdc-Version-Id` | `{versionId}` | From systeminfo endpoint |

## Environment Secrets

| Secret | Description |
|--------|-------------|
| `FM_ACCESS_TOKEN_URL` | Keycloak token endpoint |
| `FM_ACCESS_CLIENT_ID` | OAuth2 client ID |
| `FM_ACCESS_API_URL` | Base URL for HDC API (e.g. `https://landlord.bim.cloud`) |
| `FM_ACCESS_USERNAME` | Service account username |
| `FM_ACCESS_PASSWORD` | Service account password |

## Available Endpoints (via edge function)

### Read Operations

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `test-connection` | Test authentication and get version ID | - |
| `get-token` | Get auth token and version ID | - |
| `get-floors` | List floors for a building | `buildingFmGuid` |
| `get-drawings` | List drawings for a building | `buildingId` |
| `get-documents` | List documents for a building | `buildingId` |
| `get-document` | Get single document details | `documentId` |
| `get-drawing-pdf` | Get PDF download URL for a drawing | `drawingId` |
| `get-viewer-url` | Get authenticated 2D viewer URL | `buildingId`, `floorId` |
| `get-object-by-guid` | Get object details by GUID | `guid` |
| `get-hierarchy` | Get full subtree for a building | `buildingFmGuid` |
| `get-perspective-tree` | Get subtree by GUID | `guid`, `perspectiveId` |
| `search-objects` | Quick search | `query` |

### Write Operations (CRUD)

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `create-object` | Create object under parent | `parentGuid`, `name`, optional `classId`, `properties` |
| `update-object` | Update object name/properties | `guid` or `objectId`, optional `name`, `properties` |
| `delete-object` | Delete object | `guid` or `objectId` |
| `proxy` | Generic proxy to any HDC endpoint | `path`, optional `method`, `body` |

### HDC Class IDs

| ClassId | Object Type |
|---------|-------------|
| 102 | Fastighet (Estate) |
| 103 | Byggnad (Building) |
| 105 | Plan (Floor) |
| 106 | Ritning (Drawing) |
| 107 | Rum (Room) |

## Important Notes
- The HDC API uses `X-Authorization` instead of the standard `Authorization` header
- The `X-Hdc-Version-Id` header is mandatory for most endpoints
- Token is cached with a 60-second buffer before expiry
- Version ID is cached for 5 minutes
- FMGUID is the primary key for cross-system mapping between Geminus, Asset+, and FM Access
