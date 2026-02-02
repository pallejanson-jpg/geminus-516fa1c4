# Asset+ API Integration

Asset+ is a BIM-based asset management system that provides the central source of truth for building data in Geminus.

## Authentication

Asset+ uses a two-layer authentication system:

1. **OAuth2 via Keycloak** - Password grant flow for user authentication
2. **API Key** - Required in the payload of all API calls

### Token Flow

```
┌──────────────────────────────────────────────────────────────┐
│                      Authentication Flow                      │
└──────────────────────────────────────────────────────────────┘

1. POST {KEYCLOAK_URL}/protocol/openid-connect/token
   ├── grant_type: password
   ├── username: {ASSET_PLUS_USERNAME}
   ├── password: {ASSET_PLUS_PASSWORD}
   ├── client_id: {ASSET_PLUS_CLIENT_ID}
   └── client_secret: {ASSET_PLUS_CLIENT_SECRET} (optional)
   
   Response: { access_token: "...", expires_in: 300 }

2. Use access_token in Authorization header for all API calls:
   Authorization: Bearer {access_token}

3. Include API key in request body:
   { "APIKey": "{ASSET_PLUS_API_KEY}", ... }
```

## Object Types

Asset+ uses numeric object types to represent the building hierarchy:

| Type | Name | Description | Swedish |
|------|------|-------------|---------|
| 0 | Complex | Property portfolio / site | Fastighet |
| 1 | Building | Individual building | Byggnad |
| 2 | Level | Floor / building storey | Våningsplan |
| 3 | Space | Room | Rum |
| 4 | Instance | Asset / component | Objekt |

## Data Types

Property values use these data type codes:

| Code | Type | Example |
|------|------|---------|
| 0 | String | "Door A-101" |
| 1 | Int32 | 42 |
| 2 | Int64 | 9007199254740993 |
| 3 | Decimal | 123.45 |
| 4 | DateTime | "2024-01-15T10:30:00Z" |
| 5 | Bool | true |

## Key Endpoints

### Reading Data

#### `POST /PublishDataServiceGetMerged`

Main endpoint for querying objects with their properties.

```json
{
  "outputType": "raw",
  "apiKey": "your-api-key",
  "filter": ["buildingFmGuid", "=", "guid-here"]
}
```

Response includes:
- System fields (fmGuid, objectType, designation, commonName)
- Relationship fields (buildingFmGuid, levelFmGuid, inRoomFmGuid)
- User-defined properties (param1..N with flatPropertyName keys)

### Writing Data

#### `POST /AddObject` / `POST /AddObjectList`

Create new objects. Buildings require a Complex parent. Levels/Spaces/Instances require a Building parent.

```json
{
  "apiKey": "your-api-key",
  "objectType": 4,
  "designation": "Asset-001",
  "commonName": "Fire Extinguisher",
  "inRoomFmGuid": "parent-room-guid",
  "fmGuid": "optional-guid-to-preserve"
}
```

#### `POST /UpdateBimObjectsPropertiesData`

Update properties on existing objects.

```json
{
  "APIKey": "your-api-key",
  "UpdateBimObjectProperties": [{
    "FmGuid": "object-guid",
    "UpdateProperties": [{
      "Name": "commonName",
      "Type": 0,
      "Value": "Updated Name"
    }]
  }]
}
```

**Important**: 
- System parameters: Only `designation` and `commonName` can be edited
- User parameters: All values can be edited
- Use parameter's `Name` (not `flatPropertyName`) when updating

#### `POST /UpsertRelationships`

Move objects to a different parent. Only works for objects where `createdInModel = false`.

```json
{
  "APIKey": "your-api-key",
  "Relationships": [{
    "FmGuid1": "new-parent-guid",
    "FmGuid2": "object-to-move-guid"
  }]
}
```

#### `POST /ExpireObject`

Soft-delete by setting an expiration date.

```json
{
  "APIKey": "your-api-key",
  "ExpireBimObjects": [{
    "FmGuid": "object-guid",
    "ExpireDate": "2024-12-31T23:59:59Z"
  }]
}
```

## Constraints

1. **BIM Objects**: Objects created in a BIM model (`createdInModel = true`) cannot be moved via API
2. **Hierarchy**: Objects must stay within the same Building when moving
3. **Required Fields**: Buildings, Levels, Spaces require both `designation` and `commonName`
4. **Parent Required**: All objects except Complex require a parent

## Edge Functions

| Function | Purpose |
|----------|---------|
| `asset-plus-query` | Read objects from local DB (preferred) or API |
| `asset-plus-create` | Create new objects in Asset+ |
| `asset-plus-update` | Update properties (syncs both local and Asset+) |
| `asset-plus-sync` | Batch sync from Asset+ to local database |

## Sync Strategy

Due to large datasets (80k+ assets), syncing uses a resumable approach:

1. Initial sync fetches structure (Buildings, Levels, Spaces)
2. Asset sync runs per-building with pagination (skip/take)
3. Progress tracked in `asset_sync_progress` table
4. UI loops sync until local count matches remote

See [sync-api.md](./sync-api.md) for detailed sync documentation.
