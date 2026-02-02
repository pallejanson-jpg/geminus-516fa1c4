# Congeria Integration (Planned)

Congeria is a document management system (DMS) used for storing building documentation such as maintenance manuals, certificates, and technical drawings.

## Current Status: Planned

No REST API documentation is available. Integration will use session-based authentication and web scraping techniques.

## Access Information

- **URL**: https://fms.congeria.com/
- **Authentication**: Username/password login
- **Structure**: Hierarchical folder structure per building

## Folder Structure

```
Congeria
└── Demo
    └── Arkiv
        └── 3272 - Småviken
            └── DoU (Drift och Underhåll)
                └── PDF/
                    ├── Radon-protokoll.pdf
                    ├── OVK-protokoll.pdf
                    ├── Bruksanvisningar/
                    └── Produktblad/
```

## Document Metadata

From the Congeria interface, documents have these metadata fields:

| Field | Description | Example |
|-------|-------------|---------|
| Namn | File name | "Radon-protokoll 2023.pdf" |
| Typ | File type | "PDF" |
| Senast ändrad | Last modified date | "2024-01-15" |
| Storlek | File size | "2.5 MB" |
| 01_Enhet | Unit/Department | "Fastighetsförvaltning" |
| 02_Fastighet | Property | "Småviken" |
| 03_B... | Building | "B01" |

## Planned Integration

### Phase 1: Manual URL Mapping

Create a mapping table linking Geminus buildings to Congeria folder URLs:

```sql
CREATE TABLE building_external_links (
  id UUID PRIMARY KEY,
  building_fm_guid UUID NOT NULL,
  system_name TEXT NOT NULL,      -- 'congeria'
  external_url TEXT NOT NULL,     -- Full folder URL
  external_id TEXT,               -- e.g., "3272"
  created_at TIMESTAMPTZ
);
```

### Phase 2: Session-Based Sync

Edge function `congeria-sync`:

1. Login with credentials → get session cookie
2. Navigate to folder URL
3. Parse HTML to extract document list
4. Download documents to Supabase Storage
5. Store metadata in `documents` table

```typescript
// Pseudocode
async function syncDocuments(buildingFmGuid: string, folderUrl: string) {
  // 1. Login
  const session = await login(username, password);
  
  // 2. Fetch folder listing
  const html = await fetch(folderUrl, { headers: { Cookie: session } });
  
  // 3. Parse document list
  const documents = parseDocumentList(html);
  
  // 4. Download each document
  for (const doc of documents) {
    const file = await download(doc.url, session);
    await storage.upload(`documents/${buildingFmGuid}/${doc.name}`, file);
  }
  
  // 5. Store metadata
  await db.insert('documents', documents);
}
```

### Phase 3: UI Integration

Add DocumentsTab to FacilityLandingPage:

- List documents for building
- Preview/download documents
- Manual sync trigger button
- Show sync status and last sync date

## Database Schema

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,       -- Supabase Storage path
  file_size INTEGER,
  mime_type TEXT,
  source_system TEXT DEFAULT 'congeria',
  source_url TEXT,               -- Original Congeria URL
  metadata JSONB DEFAULT '{}',   -- Congeria metadata fields
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_documents_building ON documents(building_fm_guid);
```

## Secrets Required

```
CONGERIA_USERNAME
CONGERIA_PASSWORD
```

## Alternative Approaches

If session-based scraping proves unreliable:

1. **Manual Upload**: UI for manual document upload with metadata
2. **Browser Extension**: Assist users in importing from Congeria
3. **Vendor API Request**: Ask Congeria vendor about API availability
