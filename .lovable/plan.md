
# AI-Powered Batch Asset Detection from NavVis IVION 360° Images

## Executive Summary

This plan describes implementing an automated batch scanning system that uses **Gemini Vision AI** to detect fire extinguishers and emergency exit signs in NavVis IVION 360° panorama images, with a human approval workflow before assets are created.

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    AI BATCH ASSET DETECTION WORKFLOW                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  1. CONFIGURATION                  2. BATCH SCANNING                            │
│  ┌─────────────────────┐          ┌─────────────────────────────────────────┐  │
│  │ Detection Templates  │          │ Edge Function: ai-asset-detection       │  │
│  │ - Fire Extinguisher  │─────────▶│ - Get dataset list from NavVis          │  │
│  │ - Emergency Exit     │          │ - For each panorama image:              │  │
│  │ - (Extensible)       │          │   • Download via storage/redirect API    │  │
│  └─────────────────────┘          │   • Convert to base64                    │  │
│                                    │   • Send to Gemini Vision               │  │
│                                    │   • Parse bounding boxes                 │  │
│  3. PENDING DETECTIONS            │   • Calculate 3D world coordinates       │  │
│  ┌─────────────────────┐          │   • Store as pending candidates          │  │
│  │ Review Queue         │◀─────────└─────────────────────────────────────────┘  │
│  │ - Thumbnail crop     │                                                       │
│  │ - Confidence score   │                                                       │
│  │ - Suggested category │                                                       │
│  │ - Approve / Reject   │                                                       │
│  └──────────┬──────────┘                                                        │
│             │                                                                   │
│             ▼ (on approve)                                                      │
│  4. ASSET CREATION                 5. IVION SYNC                               │
│  ┌─────────────────────┐          ┌─────────────────────────────────────────┐  │
│  │ Create in Geminus   │─────────▶│ Create POI in NavVis IVION              │  │
│  │ 'assets' table      │          │ - At detected 3D position                │  │
│  │ - Auto-assign symbol │          │ - FMGUID in customData                  │  │
│  └─────────────────────┘          └─────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## NavVis IVION Image Access Strategy

Based on documentation research, NavVis IVION uses a **storage/redirect** pattern for file access:

```
GET {instance_url}/api/site/{site_id}/storage/redirect/datasets_web/{dataset_name}/pano_high/{image_id}-pano.jpg
X-Authorization: Bearer {access_token}
```

This returns a **302 redirect** to a signed AWS S3 URL that can be used to download the actual panorama image.

### Image Discovery Flow:
1. `GET /api/site/{site_id}/datasets` → List all datasets (scans) for the site
2. For each dataset, probe for available panoramas
3. Use `storage/redirect` endpoint to get signed URLs for image download

---

## Technical Implementation

### Database Schema (3 new tables)

#### Table 1: `detection_templates`
Stores configuration for each object type to detect.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Display name ("Fire Extinguisher") |
| object_type | text | Code identifier ("fire_extinguisher") |
| description | text | For human reference |
| ai_prompt | text | Specific instructions for Gemini |
| default_symbol_id | uuid | Link to annotation_symbols |
| default_category | text | Category for assets table |
| is_active | boolean | Enable/disable detection |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### Table 2: `scan_jobs`
Tracks batch scanning progress.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| building_fm_guid | text | Which building to scan |
| ivion_site_id | text | NavVis site identifier |
| templates | text[] | Array of object_types to detect |
| status | text | queued/running/completed/failed/paused |
| total_images | integer | Total panoramas to process |
| processed_images | integer | How many processed so far |
| current_dataset | text | Resume cursor |
| current_image_index | integer | Resume cursor |
| detections_found | integer | Total candidates found |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| error_message | text | |
| created_by | uuid | User who started scan |
| created_at | timestamptz | |

#### Table 3: `pending_detections`
Queue of AI-detected candidates awaiting approval.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| scan_job_id | uuid | Link to scan_jobs |
| building_fm_guid | text | Building reference |
| ivion_site_id | text | NavVis site |
| ivion_dataset_name | text | Dataset containing the panorama |
| ivion_image_id | integer | Source panorama ID |
| detection_template_id | uuid | Which template matched |
| object_type | text | fire_extinguisher/emergency_exit |
| confidence | numeric(4,3) | AI confidence 0.000-1.000 |
| bounding_box | jsonb | {ymin, xmin, ymax, xmax} normalized |
| coordinate_x | numeric | 3D world X |
| coordinate_y | numeric | 3D world Y |
| coordinate_z | numeric | 3D world Z |
| thumbnail_url | text | Cropped detection region (stored in bucket) |
| ai_description | text | What Gemini described |
| status | text | pending/approved/rejected/duplicate |
| reviewed_by | uuid | User who reviewed |
| reviewed_at | timestamptz | |
| rejection_reason | text | |
| created_asset_fm_guid | text | After approval, link to created asset |
| created_ivion_poi_id | integer | After approval, link to created POI |
| created_at | timestamptz | |

---

### Backend: Edge Function `ai-asset-detection`

**Actions:**

| Action | Description |
|--------|-------------|
| `get-templates` | List active detection templates |
| `start-scan` | Initialize a new batch scan job |
| `process-batch` | Process next batch of images (resumable, time-budgeted) |
| `get-scan-status` | Get current progress and statistics |
| `pause-scan` | Pause a running scan |
| `resume-scan` | Resume a paused scan |
| `get-pending` | Get pending detections for review |
| `approve-detection` | Approve a candidate → create asset + POI |
| `reject-detection` | Reject a candidate |
| `bulk-approve` | Approve multiple at once (high-confidence) |
| `bulk-reject` | Reject multiple at once |

**Core AI Detection Logic:**

```typescript
async function analyzeImage(
  imageBase64: string,
  templates: DetectionTemplate[]
): Promise<Detection[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  // Build combined prompt from active templates
  const objectDescriptions = templates.map(t => 
    `- ${t.name}: ${t.ai_prompt}`
  ).join('\n');
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are an expert at detecting safety equipment in 360° equirectangular panorama images.

For each object you find, return JSON with:
- object_type: the type code from the list below
- confidence: your confidence level (0.0 to 1.0)
- bounding_box: [ymin, xmin, ymax, xmax] normalized to 0-1000 scale
- description: brief description of what you see

Return a JSON array. If nothing found, return [].`
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Detect these objects in this 360° panorama:\n${objectDescriptions}` 
            },
            { 
              type: "image_url", 
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
            }
          ]
        }
      ]
    })
  });
  
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '[]';
  
  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
}
```

**Coordinate Transformation (2D image → 3D world):**

```typescript
function imageToWorldCoords(
  bbox: {ymin: number, xmin: number, ymax: number, xmax: number},
  cameraPos: {x: number, y: number, z: number},
  imageWidth: number = 1000,
  imageHeight: number = 1000,
  estimatedDepth: number = 2.0  // meters from camera
): {x: number, y: number, z: number} {
  // Center of bounding box
  const centerX = (bbox.xmin + bbox.xmax) / 2;
  const centerY = (bbox.ymin + bbox.ymax) / 2;
  
  // Convert to spherical coordinates
  // Equirectangular projection: x maps to longitude, y maps to latitude
  const longitude = ((centerX / imageWidth) - 0.5) * 2 * Math.PI;  // -π to π
  const latitude = (0.5 - (centerY / imageHeight)) * Math.PI;      // -π/2 to π/2
  
  // Convert spherical to Cartesian direction
  const dirX = Math.cos(latitude) * Math.sin(longitude);
  const dirY = Math.sin(latitude);
  const dirZ = Math.cos(latitude) * Math.cos(longitude);
  
  // Project from camera position
  return {
    x: cameraPos.x + dirX * estimatedDepth,
    y: cameraPos.y + dirY * estimatedDepth,
    z: cameraPos.z + dirZ * estimatedDepth
  };
}
```

---

### Frontend: New Pages and Components

#### New Route: `/inventory/ai-scan`

**Components to create:**

| Component | Purpose |
|-----------|---------|
| `AiAssetScan.tsx` (page) | Main scanning interface |
| `ScanConfigPanel.tsx` | Select building, choose templates, start scan |
| `ScanProgressPanel.tsx` | Real-time progress with stats |
| `DetectionReviewQueue.tsx` | Grid of pending detections |
| `DetectionCard.tsx` | Single detection with thumbnail, confidence badge |
| `DetectionDetailDialog.tsx` | Full-size view with bounding box overlay |
| `BulkActionsToolbar.tsx` | Select all high-confidence, bulk approve/reject |

**User Flow:**

1. **Select Building** → Dropdown of buildings with Ivion configured
2. **Choose Detection Types** → Checkboxes for fire extinguisher, emergency exit
3. **Start Scan** → Shows progress: "Processing panorama 45/230... Found 12 candidates"
4. **Review Results** → Grid shows thumbnails with confidence badges
5. **Filter** → "High confidence (>85%)" / "Needs review (50-85%)" / "Low confidence (<50%)"
6. **Approve** → Creates asset in Geminus + POI in Ivion
7. **Reject** → Marks as rejected with optional reason

---

### Integration with Existing Inventory

Approved detections:
- Create asset in `assets` table with `is_local=true`, `annotation_placed=true`
- Set `ivion_poi_id`, `ivion_site_id`, `ivion_image_id`
- Link to `symbol_id` from detection template
- Set `asset_type` to category code

These assets then appear:
- In the main Inventory list (`/inventory`)
- In the Navigator tree
- Can be synced to Asset+ via existing sync mechanism

---

## Files to Create

### New Files

| File | Purpose |
|------|---------|
| `supabase/functions/ai-asset-detection/index.ts` | Core batch scanning + AI logic |
| `src/pages/AiAssetScan.tsx` | Main scanning page |
| `src/components/ai-scan/ScanConfigPanel.tsx` | Configuration UI |
| `src/components/ai-scan/ScanProgressPanel.tsx` | Progress display |
| `src/components/ai-scan/DetectionReviewQueue.tsx` | Review grid |
| `src/components/ai-scan/DetectionCard.tsx` | Detection card component |
| `src/components/ai-scan/DetectionDetailDialog.tsx` | Detail view |
| `src/components/ai-scan/BulkActionsToolbar.tsx` | Bulk operations |

### Modified Files

| File | Changes |
|------|---------|
| `src/App.tsx` | Add route `/inventory/ai-scan` |
| `src/pages/Inventory.tsx` | Add "AI Scan" button in header |
| `supabase/functions/ivion-poi/index.ts` | Add helper to get datasets and panorama list |
| `supabase/config.toml` | Add `ai-asset-detection` function config |

---

## Database Migration

```sql
-- Detection templates configuration
CREATE TABLE public.detection_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  object_type TEXT NOT NULL UNIQUE,
  description TEXT,
  ai_prompt TEXT NOT NULL,
  default_symbol_id UUID REFERENCES public.annotation_symbols(id),
  default_category TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.detection_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "detection_templates_read" ON public.detection_templates 
  FOR SELECT USING (true);
CREATE POLICY "detection_templates_write" ON public.detection_templates 
  FOR ALL USING (public.is_admin());

-- Seed initial templates
INSERT INTO public.detection_templates (name, object_type, description, ai_prompt, default_category) VALUES
(
  'Fire Extinguisher', 
  'fire_extinguisher',
  'Red fire extinguisher cylinders, wall-mounted or floor-standing',
  'Look for red fire extinguisher cylinders. They are typically cylindrical, red or partially red, mounted on walls at about 1-1.5m height, or standing on the floor. May have hose attachment.',
  'fire_extinguisher'
),
(
  'Emergency Exit Sign',
  'emergency_exit',
  'Green illuminated signs with running figure, above doors or in corridors',
  'Look for green emergency exit signs. They show a running figure pictogram pointing to an exit. Usually illuminated, mounted above doors or high on walls. May include arrow direction.',
  'emergency_exit'
);

-- Scan jobs tracking
CREATE TABLE public.scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid TEXT NOT NULL,
  ivion_site_id TEXT NOT NULL,
  templates TEXT[] NOT NULL,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed')),
  total_images INTEGER DEFAULT 0,
  processed_images INTEGER DEFAULT 0,
  current_dataset TEXT,
  current_image_index INTEGER DEFAULT 0,
  detections_found INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_by UUID REFERENCES public.profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_jobs_read" ON public.scan_jobs 
  FOR SELECT USING (true);
CREATE POLICY "scan_jobs_write" ON public.scan_jobs 
  FOR ALL USING (auth.uid() = created_by OR public.is_admin());

-- Pending detections queue
CREATE TABLE public.pending_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_job_id UUID NOT NULL REFERENCES public.scan_jobs(id) ON DELETE CASCADE,
  building_fm_guid TEXT NOT NULL,
  ivion_site_id TEXT NOT NULL,
  ivion_dataset_name TEXT,
  ivion_image_id INTEGER,
  detection_template_id UUID REFERENCES public.detection_templates(id),
  object_type TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  bounding_box JSONB NOT NULL,
  coordinate_x NUMERIC,
  coordinate_y NUMERIC,
  coordinate_z NUMERIC,
  thumbnail_url TEXT,
  ai_description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate')),
  reviewed_by UUID REFERENCES public.profiles(user_id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_asset_fm_guid TEXT,
  created_ivion_poi_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pending_detections_status ON public.pending_detections(status);
CREATE INDEX idx_pending_detections_job ON public.pending_detections(scan_job_id);
CREATE INDEX idx_pending_detections_building ON public.pending_detections(building_fm_guid);

ALTER TABLE public.pending_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_detections_read" ON public.pending_detections 
  FOR SELECT USING (true);
CREATE POLICY "pending_detections_write" ON public.pending_detections 
  FOR ALL USING (auth.uid() IS NOT NULL);
```

---

## Implementation Phases

### Phase 1: Database + Backend Skeleton
- Create migration with 3 tables
- Create edge function skeleton
- Implement `get-templates`, `get-pending` actions
- Test NavVis image access (storage/redirect endpoint)

### Phase 2: AI Detection Logic
- Implement Gemini Vision integration
- Add coordinate transformation
- Implement `start-scan` and `process-batch` (resumable)
- Store thumbnails in bucket

### Phase 3: Frontend - Scan Configuration
- Create AiAssetScan page
- Build ScanConfigPanel
- Build ScanProgressPanel
- Wire up to backend

### Phase 4: Frontend - Review Queue
- Build DetectionReviewQueue
- Build DetectionCard and DetectionDetailDialog
- Implement approve/reject flow
- Wire to asset + POI creation

### Phase 5: Integration + Polish
- Add "AI Scan" button to Inventory page
- Bulk actions for high-confidence detections
- Error handling and retry logic
- End-to-end testing

---

## Expected Accuracy

Based on Gemini Vision capabilities with clear object types:

| Object Type | Detection Rate | False Positive Rate |
|-------------|----------------|---------------------|
| Fire Extinguisher | 85-95% | 5-10% |
| Emergency Exit Sign | 90-98% | 3-8% |

The human approval workflow ensures no false positives make it into the final asset database.

---

## Cost Estimate

- Gemini 2.5 Flash: ~$0.0003 per image
- Typical building: 200-500 panoramas
- Cost per building scan: $0.06 - $0.15
- Included in Lovable AI free tier for most use cases

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| NavVis image access blocked | Probe multiple URL patterns; fallback to manual export |
| Token expiration mid-scan | Auto-refresh token; resumable scans |
| Rate limits | Time-budgeted batching; pause/resume |
| Low accuracy | Confidence thresholds; human review required |
| Large buildings | Resumable processing; progress tracking |

