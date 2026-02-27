

# Plan: Assistant Unification, Voice Training, Ilean Context, 3D Optimization, and Bug Fixes

This is a large scope. Here's a prioritized breakdown of the work.

---

## 1. Fix Red Toast Error in Settings

**Root cause**: The ACC integration auto-fetches folders when `ApiSettingsModal` opens and ACC auth status is "authenticated". If the ACC project/hub config is stale or permissions changed, it throws a 403 error from Autodesk's API.

**Fix**: Guard `handleFetchAccFolders` from auto-firing on modal open. Only fetch when the user explicitly clicks the button. Remove the auto-fetch in the `useEffect` at line ~690 in `ApiSettingsModal.tsx`.

---

## 2. Make Voice Control Button Draggable

Currently `VoiceControlButton` is a static `fixed` positioned element. Refactor it to match the Gunnar/Ilean pattern:
- Add drag state management (position, isDragging)
- Save/restore position via localStorage (key: `voice-control-position`)
- Add drag handlers (mousedown/touchstart → mousemove/touchmove → mouseup/touchend)
- Add position reset in `VoiceSettings`

---

## 3. Unify All Assistants to Gunnar Format

Voice and Ilean buttons should match Gunnar's UX pattern:
- **Resizable panel** (drag bottom-right corner)
- **Context-aware** (building/floor/room/asset)
- **Draggable trigger button** with saved position

For Voice specifically:
- Replace the current inline transcription popup with a Gunnar-style resizable panel
- Panel shows transcription history, command feedback, and help commands
- Panel is minimizable to bubble

For Ilean:
- Already has draggable button and panel, but needs context improvements (step 4)

---

## 4. Fix Ilean Context Awareness

Current `useIleanContext` hook listens for `FLOOR_SELECTION_CHANGED` and facility changes but the Ilean button doesn't properly use it. Fix:
- Wire `IleanButton` to consume `useIleanContext` properly
- Implement fallback chain: Room → Floor → Building
- When a room/asset is selected in viewer, update Ilean context via `setRoomContext`
- Listen to `VIEWER_CONTEXT_CHANGED_EVENT` for asset/room selection
- Update Ilean panel header to show current context level (Building/Floor/Room)

---

## 5. Expand Voice Command Registry

Currently only ~12 commands. Add:
- **Floor commands**: "visa våning 2", "gå till plan 3", "isolera våning 1"
- **Room commands**: "visa rum 101", "sök rum [namn]"
- **View mode**: "byt till 2D", "visa split-vy", "öppna 360"
- **Visualization**: "visa energiförbrukning", "visa temperatur"
- **Inventory**: "öppna inventering", "registrera tillgång"
- **Issue**: "skapa ärende", "öppna felanmälan"
- **Building selection**: "byt byggnad till [namn]"
- **Filter**: "filtrera på [typ]", "rensa filter"

---

## 6. 3D Viewer Performance — Analysis & Recommendations

### Current state:
- **XKT caching**: Implemented via `xkt-cache-service.ts` (Cache-on-Load strategy). Models are cached in Supabase Storage after first load.
- **Memory bridge**: `useXktPreload` pre-fetches models to ArrayBuffer, `AssetPlusViewer` intercepts fetch to serve from memory.
- **FastNavPlugin**: Installed — reduces resolution during camera movement (0.5-0.6x). This is the "blur" the user sees.
- **ViewCullPlugin**: Frustum culling active.
- **LOD culling**: Active for scenes <50k objects.

### FastNavPlugin blur toggle:
Add a setting in `ViewerThemeSettings` or a new "Viewer Performance" section under User Settings:
- Toggle: "Smooth navigation (reduces quality during camera movement)"
- Default: ON
- When OFF: destroy `FastNavPlugin` or set `scaleCanvasResolution: false`

### Performance improvements to implement:
1. **Verify XKT cache is actually being used**: Add console diagnostics showing cache hit/miss during load
2. **Preload on building selection**: Trigger `useXktPreload` earlier (when building is selected in portfolio, not just when viewer opens)
3. **Loading state UX**: Show a progress bar with model name during loading instead of just a spinner

### Regarding switching to native xeokit viewer:
This is a significant architectural change. The Asset+ viewer wraps xeokit with additional BIM features (property panels, etc.). A migration plan would need to:
- Replace the Asset+ SDK container with a bare `xeokit.Viewer`
- Reimplement model loading using `XKTLoaderPlugin` directly
- Keep all existing features (floor isolation, visualization, room labels, etc.)
- This is a multi-week effort and should be planned separately.

---

## Implementation Order

1. Fix red toast (quick fix, 1 edit)
2. Add FastNavPlugin toggle in settings
3. Make Voice button draggable
4. Fix Ilean context awareness
5. Expand voice commands
6. Unify assistant panel format

Steps 1-2 are quick. Steps 3-6 are progressively larger.

---

## Technical Details

### Files to modify:
- `src/components/settings/ApiSettingsModal.tsx` — remove auto-fetch guard
- `src/hooks/usePerformancePlugins.ts` — read FastNav setting from localStorage
- `src/components/settings/ViewerThemeSettings.tsx` — add FastNav toggle
- `src/components/voice/VoiceControlButton.tsx` — full rewrite to draggable panel format
- `src/hooks/useVoiceCommands.ts` — expand command registry
- `src/components/chat/IleanButton.tsx` — wire context from `useIleanContext` + viewer events
- `src/components/settings/VoiceSettings.tsx` — add position reset button

