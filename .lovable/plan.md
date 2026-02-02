
# Plan: DocumentsTab and Congeria Sync Integration

## Overview

This plan adds:
1. **DocumentsView component** - A panel to display synced documents for a building
2. **Docs+ Quick Action** - Link the FileText button to open DocumentsView instead of switching apps
3. **Congeria Sync Tab** - Add manual document sync controls in ApiSettingsModal under the Sync tab

---

## Current Behavior Analysis

| Component | Current Behavior |
|-----------|------------------|
| QuickActions → Docs+ button | Calls `onShowDocs(facility)` which switches to `original_archive` app |
| PortfolioView | `handleShowDocs` just does `setActiveApp('original_archive')` |
| ApiSettingsModal → Sync tab | Has Asset+, XKT, FM Access, Senslinc, Ivion sync sections - no Congeria |

---

## Proposed Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    PortfolioView                            │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ FacilityCard    │    │ FacilityLandingPage             │ │
│  │                 │    │                                 │ │
│  │                 │    │  QuickActions                   │ │
│  │                 │    │    └─ Docs+ → onShowDocs()      │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────────┤
│  │ DocumentsView (NEW)                                      │
│  │ - Shows when showDocsFor is set                          │
│  │ - Lists documents from `documents` table                 │
│  │ - Download links to Supabase Storage                     │
│  │ - Shows metadata (type, size, sync date)                 │
│  └──────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ApiSettingsModal → Sync Tab                                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Asset+ Synkronisering (existing)                        ││
│  │ - Structure, Assets, XKT                                ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Congeria Dokument Sync (NEW)                            ││
│  │ - Per-building config: URL mapping                      ││
│  │ - Sync button                                           ││
│  │ - Status display                                        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### Part 1: DocumentsView Component

**New file: `src/components/portfolio/DocumentsView.tsx`**

```typescript
interface DocumentsViewProps {
  facility: Facility;
  onClose: () => void;
  onSelectDocument?: (doc: Document) => void;
}

// Features:
// - Header with building name and close button
// - Document list from Supabase `documents` table
// - Group by folder/category from metadata
// - Download button for each document
// - External link to original Congeria URL
// - Sync status indicator
// - Empty state if no documents
```

**Document list columns:**
| Column | Source |
|--------|--------|
| Name | `file_name` |
| Type | `mime_type` or metadata |
| Size | `file_size` (formatted) |
| Synced | `synced_at` |
| Actions | Download / Open Original |

---

### Part 2: Wire Up in PortfolioView

**File: `src/components/portfolio/PortfolioView.tsx`**

Add state and handler similar to AssetsView/RoomsView pattern:

```typescript
// Add state (around line 45)
const [showDocsFor, setShowDocsFor] = useState<Facility | null>(null);

// Replace handler (line 183)
const handleShowDocs = (facility: Facility) => {
  setShowDocsFor(facility);  // Instead of setActiveApp('original_archive')
};

// Add render condition (after AssetsView around line 395)
{showDocsFor && (
  <DocumentsView
    facility={showDocsFor}
    onClose={() => setShowDocsFor(null)}
  />
)}
```

---

### Part 3: Congeria Sync in ApiSettingsModal

**File: `src/components/settings/ApiSettingsModal.tsx`**

Add a new Congeria sync section in the Sync tab (after line ~1500):

```typescript
{/* Congeria Document Sync Section */}
<div className="border rounded-lg p-4 space-y-4">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <FileText className="h-5 w-5 text-blue-500" />
      <div>
        <h4 className="font-medium">Congeria Dokument</h4>
        <p className="text-xs text-muted-foreground">
          {documentCount} dokument synkade
        </p>
      </div>
    </div>
    <div className="flex items-center gap-2">
      {connectionStatus}
      <Button onClick={handleSyncCongeria}>
        Synka dokument
      </Button>
    </div>
  </div>
  
  {/* Building URL mapping table */}
  <div className="space-y-2">
    {buildings.map(building => (
      <div key={building.fmGuid} className="flex items-center gap-2">
        <span>{building.name}</span>
        <Input 
          placeholder="https://fms.congeria.com/..."
          value={congeriaUrls[building.fmGuid] || ''}
          onChange={...}
        />
        <Button size="sm" onClick={() => syncBuilding(building.fmGuid)}>
          Synka
        </Button>
      </div>
    ))}
  </div>
</div>
```

**State additions:**
```typescript
const [congeriaUrls, setCongeriaUrls] = useState<Record<string, string>>({});
const [isSyncingCongeria, setIsSyncingCongeria] = useState(false);
const [documentCount, setDocumentCount] = useState(0);
```

**Functions to add:**
```typescript
// Fetch building external links for Congeria
const fetchCongeriaLinks = async () => {
  const { data } = await supabase
    .from('building_external_links')
    .select('*')
    .eq('system_name', 'congeria');
  // Map to state
};

// Save Congeria URL for building
const saveCongeriaUrl = async (buildingFmGuid: string, url: string) => {
  await supabase.from('building_external_links').upsert({
    building_fm_guid: buildingFmGuid,
    system_name: 'congeria',
    external_url: url,
    display_name: 'Document Archive'
  }, { onConflict: 'building_fm_guid,system_name' });
};

// Trigger sync for specific building
const handleSyncCongeria = async (buildingFmGuid?: string) => {
  setIsSyncingCongeria(true);
  const { data, error } = await supabase.functions.invoke('congeria-sync', {
    body: { buildingFmGuid, action: 'sync' }
  });
  // Handle response
  setIsSyncingCongeria(false);
  await fetchDocumentCount();
};
```

---

### Part 4: Edge Function for Congeria Sync

**New file: `supabase/functions/congeria-sync/index.ts`**

This is a placeholder/skeleton that will be expanded when we understand Congeria's auth flow better:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { buildingFmGuid, action } = await req.json();
  
  const username = Deno.env.get("CONGERIA_USERNAME");
  const password = Deno.env.get("CONGERIA_PASSWORD");
  
  // 1. Login to Congeria (session-based)
  // 2. Navigate to building folder URL
  // 3. Parse document list from HTML
  // 4. Download each document to Supabase Storage
  // 5. Insert/update documents table
  
  return new Response(
    JSON.stringify({ 
      success: true, 
      message: 'Congeria sync not yet implemented - placeholder' 
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
```

---

## Database Usage

**Existing tables (created in previous migration):**

```sql
-- Already exists: documents table
SELECT * FROM documents WHERE building_fm_guid = 'xxx';

-- Already exists: building_external_links table  
SELECT * FROM building_external_links 
WHERE system_name = 'congeria' AND building_fm_guid = 'xxx';
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/components/portfolio/DocumentsView.tsx` | **NEW** | Document list component |
| `src/components/portfolio/PortfolioView.tsx` | **MODIFY** | Add showDocsFor state, render DocumentsView |
| `src/components/settings/ApiSettingsModal.tsx` | **MODIFY** | Add Congeria sync section in Sync tab |
| `supabase/functions/congeria-sync/index.ts` | **NEW** | Edge function placeholder for document sync |

---

## UI Mockup: DocumentsView

```text
┌──────────────────────────────────────────────────────────────┐
│ [←] Dokument - Småviken                          [Synka] [X] │
├──────────────────────────────────────────────────────────────┤
│ 🔍 Sök dokument...                                           │
├──────────────────────────────────────────────────────────────┤
│ 📁 DoU (Drift & Underhåll)                                   │
│ ├── 📄 Radon-protokoll 2023.pdf          2.1 MB    [⬇️]     │
│ ├── 📄 OVK-protokoll Plan 1.pdf          1.5 MB    [⬇️]     │
│ ├── 📄 Bruksanvisning VVS.pdf            4.2 MB    [⬇️]     │
│ └── 📄 Produktblad Ventilation.pdf       892 KB    [⬇️]     │
│                                                              │
│ 📁 Ritningar                                                 │
│ ├── 📄 A-40-01 Plan 1.pdf                12.3 MB   [⬇️]     │
│ └── 📄 A-40-02 Plan 2.pdf                11.8 MB   [⬇️]     │
├──────────────────────────────────────────────────────────────┤
│ Senast synkad: 2026-02-02 21:45                              │
│ Källa: Congeria                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## UI Mockup: Congeria Section in Sync Tab

```text
┌──────────────────────────────────────────────────────────────┐
│ 📄 Congeria Dokument                                         │
│ 12 dokument synkade                               [Synka]    │
├──────────────────────────────────────────────────────────────┤
│ Byggnad          │ Congeria URL                   │ Status   │
│ ─────────────────┼────────────────────────────────┼──────────│
│ Småviken         │ https://fms.congeria.com/...   │ ✓ Synkad │
│ Norrmalm 12      │ [Ange URL...]                  │ Ej konf. │
│ Vasahuset        │ [Ange URL...]                  │ Ej konf. │
└──────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

1. **Create DocumentsView.tsx** - Basic UI to list documents from database
2. **Update PortfolioView.tsx** - Add state and render DocumentsView when Docs+ clicked
3. **Update ApiSettingsModal.tsx** - Add Congeria section with URL mapping UI
4. **Create congeria-sync Edge Function** - Placeholder ready for real implementation

---

## Technical Notes

### Document Storage Path
Documents will be stored in Supabase Storage bucket `documents`:
```
documents/{building_fm_guid}/{file_name}
```

### Metadata JSONB
The `metadata` field in documents table stores Congeria-specific fields:
```json
{
  "01_Enhet": "Stockholm",
  "02_Fastighet": "Småviken",
  "congeria_path": "/Demo/Arkiv/3272 - Småviken/DoU/",
  "original_url": "https://fms.congeria.com/..."
}
```

### Empty State
When no documents exist for a building, show a call-to-action:
- "Inga dokument synkade"
- Link to settings to configure Congeria URL
- Manual upload option (future feature)
