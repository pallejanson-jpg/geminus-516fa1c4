

## Updated Plan: BCF Issue Annotations + Resend API Key

### Addition 1: Resend API Key

**Where to get it:**
1. Go to [resend.com](https://resend.com) and create a free account
2. Navigate to **API Keys** in the dashboard
3. Click **Create API Key**, give it a name, select **Sending access**
4. Copy the key (starts with `re_...`)
5. Free tier: 100 emails/day, 3,000 emails/month

You will also need to verify a sending domain in Resend (Settings > Domains) or use the sandbox `onboarding@resend.dev` for testing. I will prompt you to enter the key when we start implementing the edge function.

---

### Addition 2: BCF Issue Annotations in 3D Viewer

Issues with a saved viewpoint will appear as clickable annotation markers in the 3D scene, following the same pattern as existing local annotations (asset markers).

#### How it works

1. **Marker position**: Derived from the issue's `viewpoint_json`. The "look at" point (`camera_view_point + camera_direction`) becomes the 3D world position for the marker. If `selected_object_ids` exist, use the center of the first selected object's bounding box instead (more accurate).

2. **Marker appearance**: Red circle with an issue-type icon (AlertCircle for faults, Lightbulb for improvements, etc.), using the same 28px circular marker style as existing annotations but with issue-type-specific colors.

3. **Click behavior**: Clicking an issue marker restores the full BCF viewpoint (camera position + selection + clipping) and opens the `IssueDetailSheet` for that issue.

4. **Floor awareness**: Issue markers will be shown/hidden based on the active floor, using the `building_fm_guid` for filtering. Issues without floor context show on all floors.

5. **Category filtering**: Issue annotations appear as a new category in the `ViewerFilterPanel` annotations section, allowing users to toggle issue marker visibility.

#### Implementation

**File: `src/components/viewer/AssetPlusViewer.tsx`**

New function `loadIssueAnnotations`:
- Fetches open BCF issues for the current `buildingFmGuid` from `bcf_issues` table
- Extracts world position from `viewpoint_json` (look-at point) or from first selected object's scene position
- Creates DOM marker elements in the same `local-annotations-container` (or a separate `issue-annotations-container`)
- Uses the same `projectWorldToCanvas` helper for 3D-to-2D projection
- Subscribes to realtime changes on `bcf_issues` to add/remove markers when issues are created or resolved
- Called from `handleAllModelsLoaded` alongside `loadLocalAnnotations`

**Marker creation logic (pseudocode):**
```typescript
// Extract position from viewpoint
const vp = issue.viewpoint_json;
const cam = vp.perspective_camera || vp.orthogonal_camera;
const eye = cam.camera_view_point;
const dir = cam.camera_direction;
// look-at = eye + direction (normalized, scaled by ~5m)
const len = Math.sqrt(dir.x*dir.x + dir.y*dir.y + dir.z*dir.z);
const worldPos = [eye.x + dir.x/len*5, eye.y + dir.y/len*5, eye.z + dir.z/len*5];
```

**Click handler:**
- Calls `restoreViewpoint(issue.viewpoint_json)` 
- Opens `IssueDetailSheet` with the issue data

**Realtime subscription:**
- Listens for INSERT/UPDATE/DELETE on `bcf_issues` where `building_fm_guid` matches
- Adds new markers on INSERT, removes on DELETE, updates visibility on status change (hide resolved)

#### Files to modify

| File | Changes |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Add `loadIssueAnnotations` function, call from `handleAllModelsLoaded`, add realtime subscription, add issue marker click handler |
| `src/components/viewer/ViewerFilterPanel.tsx` | Add "Issues" as a toggleable annotation category |

---

### Summary of full implementation order

| Step | Task |
|---|---|
| 1 | Request `RESEND_API_KEY` secret |
| 2 | Create `send-issue-email` edge function |
| 3 | Create `SendIssueDialog` component |
| 4 | Update `IssueDetailSheet` with send button + English translation |
| 5 | Translate `IssueListPanel` + `FloatingIssueListPanel` to English |
| 6 | Create `IssueResolution` page + add route |
| 7 | Add issue annotations in 3D viewer (loadIssueAnnotations) |
| 8 | Enhance `CreateWorkOrderDialog` with BCF attachment + hierarchy |
| 9 | Update `AssetPlusViewer` to pass full context to work order dialog |
| 10 | Add work order creation from Navigator |

