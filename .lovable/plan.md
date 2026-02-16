
## Plan: Fix Toolbar Freeze, Disable Unavailable Quick Actions

This plan addresses three issues:
1. **3D toolbar freezes/disappears** when loading from the "3D Viewer" main menu entry
2. **Quick Actions buttons are always active** even when no 3D models or 360 data exists for the building
3. Minor: the console shows repeated XKT cache requests in a tight loop (related to issue 1)

---

### Issue 1: Navigation Toolbar Not Visible / Menus Freeze

**Root cause:** When the 3D Viewer is opened via the BuildingSelector (no `building` param in URL), the user selects a building and `navigate()` is called. However, the AssetPlusViewer component mounts and starts loading XKT models. The repeated "XKT cache hit" logs (dozens per second) suggest the XKT loader is retrying a model that fails to parse (`RangeError: Offset is outside the bounds of the DataView`). This creates a tight async loop that starves the UI thread, making the toolbar unresponsive and potentially preventing it from rendering.

The toolbar itself depends on `isViewerReady` which polls the xeokit viewer via `setTimeout` at 200ms, 500ms, and 1000ms. If the viewer crashes during model parsing (the DataView error), the scene may never be fully ready, leaving `isViewerReady = false` and all toolbar buttons disabled.

**Fix:**
- In `AssetPlusViewer.tsx`, add error handling around individual XKT model loads. If a model fails to parse (the DataView RangeError), log the error, skip that model, and continue. Do not retry infinitely.
- In the XKT cache service, add a per-model retry limit (max 2 attempts) to prevent the infinite retry loop visible in the console logs.
- Ensure `isViewerReady` can become `true` even if some models fail to load (the scene exists even without loaded models).

**Files:**
- `src/components/viewer/AssetPlusViewer.tsx` -- add try/catch around model load, track failed models
- `src/services/xkt-cache-service.ts` -- add retry guard

---

### Issue 2: Quick Actions Should Be Disabled When No Data Exists

**Problem:** The Quick Actions grid (3D, 360, 3D+360, 2D Ritning, Virtual Twin) shows all buttons as active even when the building has no 3D models (XKT), no Ivion 360 site, or no FM Access drawings.

**Current data:**
- Buildings with XKT models: Centralstationen, Smaviken, Akerselva Atrium
- Buildings with Ivion 360: Centralstationen (3045176558137335), Akerselva Atrium (3373717251911143)
- Stadshuset Nykoping (ACC): no XKT models, no Ivion, no FM Access
- Labradorgatan 18: no Ivion, no FM Access

**Fix in `QuickActions.tsx`:**
- Accept new props: `has3DModels: boolean` and `hasFmAccess: boolean`
- Disable (gray out) the 3D button when `has3DModels === false`
- Disable the 360 button when `ivionSiteId` is null/undefined
- Disable the 3D+360 (Split) button when either 3D or 360 is unavailable
- Disable the Virtual Twin button when either 3D or 360 is unavailable
- Disable the 2D Ritning button when `hasFmAccess === false`
- Use `opacity-50 cursor-not-allowed` styling and prevent click when disabled
- Show a tooltip explaining why it's disabled (e.g., "Ingen 3D-modell synkad")

**Fix in `FacilityLandingPage.tsx`:**
- Use the existing `useXktPreload` hook or query `xkt_models` table to check if models exist for the building
- Check `building_settings.ivion_site_id` (already available via `settings?.ivionSiteId`)
- Check FM Access availability (query `building_external_links` or `building_settings.fm_access_building_guid`)
- Pass `has3DModels`, `hasFmAccess` to QuickActions

---

### Implementation Sequence

| Step | Task | Files |
|------|------|-------|
| 1 | Add XKT model count check + FM Access check in FacilityLandingPage | `FacilityLandingPage.tsx` |
| 2 | Add disabled state to Quick Action buttons | `QuickActions.tsx` |
| 3 | Add error handling for failed XKT model loads to prevent freeze | `AssetPlusViewer.tsx` |
| 4 | Add retry limit in XKT cache service | `xkt-cache-service.ts` |

---

### Technical Details

**QuickActions disabled state:**
```typescript
// New props
interface QuickActionsProps {
  // ... existing props
  has3DModels?: boolean;
  hasFmAccess?: boolean;
}

// Button disabled logic
const has3D = has3DModels !== false; // default true for backward compat
const has360 = !!ivionSiteId;
const hasSplit = has3D && has360;
const has2D = hasFmAccess !== false;
```

**FacilityLandingPage XKT check:**
```typescript
const [has3DModels, setHas3DModels] = useState<boolean | undefined>(undefined);

useEffect(() => {
  if (!buildingGuid) return;
  supabase
    .from('xkt_models')
    .select('id', { count: 'exact', head: true })
    .eq('building_fm_guid', buildingGuid)
    .then(({ count }) => setHas3DModels((count ?? 0) > 0));
}, [buildingGuid]);
```

**XKT load error handling in AssetPlusViewer:**
```typescript
// Around the model load loop, add per-model try/catch:
try {
  await loadXktModel(modelUrl, modelId);
} catch (err) {
  console.error(`[AssetPlusViewer] Failed to load model ${modelId}:`, err);
  failedModels.add(modelId);
  // Continue loading remaining models
}
```
