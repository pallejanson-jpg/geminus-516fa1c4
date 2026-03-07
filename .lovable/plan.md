

# Fix Plan: Mobile Viewer Issues, Gunnar Problems & Swedish Text Cleanup

## Issues Found

### 1. 2D Mode Doesn't Work on Mobile
**Root cause**: When mobile uses `NativeViewerShell` directly (in non-split modes, lines 900-906 of UnifiedViewer), it renders `NativeViewerShell` which includes `ViewerToolbar`. The `MobileViewerOverlay` dispatches `VIEW_MODE_REQUESTED_EVENT` via `handleChangeViewMode` (NativeViewerShell line 420-423), and `ViewerToolbar` listens for it (line 250-257) and calls `handleViewModeChange('2d')` which does the actual clipping + ortho camera.

**The actual problem**: In the mobile split view (`split2d3d` mode, lines 807-895), the top panel renders `SplitPlanView` (a canvas-based 2D representation), NOT the xeokit 2D mode with clipping. The `SplitPlanView` is a simplified canvas drawing of rooms/walls from AABB data — it's NOT the proper 2D floor plan mode. When the user selects "2D" mode (not split), it renders `NativeViewerShell` (line 901) which should dispatch `VIEW_MODE_REQUESTED_EVENT`, but the `MobileViewerOverlay` has a mode switcher that's rendered INSIDE the shell (line 456-468). The shell's `handleChangeViewMode` dispatches the event correctly.

**Likely issue**: The mobile mode switcher in the split overlay (lines 866-893) calls `setViewMode(mode)` on the parent `MobileUnifiedViewer`, but when switching from `split2d3d` to `2d`, the `NativeViewerShell` is mounted anew (line 901) and the `VIEW_MODE_REQUESTED_EVENT` needs to be dispatched AFTER the shell's `ViewerToolbar` has mounted. The `UnifiedViewer` dispatches 2D events (lines 254-265) with 1.5s and 3s delays, but only when `viewerReady` is true. There's likely a race condition where the viewer isn't ready yet when the event fires.

**Fix**: In `MobileUnifiedViewer`, when mode changes to `2d`, ensure `VIEW_MODE_REQUESTED_EVENT` and `VIEW_MODE_2D_TOGGLED_EVENT` are dispatched with proper delays after the NativeViewerShell has mounted. Also, when in `2d` mode on mobile, hide the `MobileViewerOverlay`'s own mode switcher to avoid the duplicate with NativeViewerShell's built-in one.

### 2. Split Screen Shows Regular 3D (No 2D Plan)
**Root cause**: The split mode on mobile renders `SplitPlanView` on top and `NativeViewerShell` on bottom. `SplitPlanView` works by reading from `window.__nativeXeokitViewer` and drawing room AABBs on a canvas. If the viewer hasn't loaded yet or the `__nativeXeokitViewer` ref isn't set, it shows nothing useful. Additionally, the bottom `NativeViewerShell` shows normal 3D — there's no clipping applied because no 2D event was dispatched for it.

**Fix**: The split mode should work correctly — `SplitPlanView` reads from the shared xeokit instance. The issue is likely that both panels create their own `NativeViewerShell` instances. The bottom NativeViewerShell creates a new viewer, but `SplitPlanView` tries to read from `window.__nativeXeokitViewer`. Since both panels mount simultaneously, the timing works if the bottom shell loads first. Need to verify this works or add a viewer-ready listener in SplitPlanView.

### 3. Duplicate Icons in Mobile Mode Switcher
**Root cause**: When in non-split mobile mode (line 896-942), `NativeViewerShell` is rendered which includes its own `MobileViewerOverlay` (line 456-468). But `MobileUnifiedViewer` doesn't add any external mode switcher for non-split modes — the `MobileViewerOverlay` inside NativeViewerShell IS the only one. However, NativeViewerShell's `MobileViewerOverlay` includes `2D`, `3D`, `360°` but also `2D/3D` (split) — that's 4 buttons. Looking at the `MobileViewerOverlay` component (lines 63-101), it shows `2D/3D`, `2D`, `3D`, and optionally `360°`. That's correct.

**Wait** — the issue is that in split mode (lines 849-894), there's ANOTHER mode switcher rendered as `absolute top-0 right-0 z-40` with its own buttons. So when the user goes to split mode and then back to 3D, the NativeViewerShell's own MobileViewerOverlay also shows. These are two separate mode switchers competing.

**Fix**: When `MobileUnifiedViewer` renders the NativeViewerShell in non-split mode, pass a prop to hide NativeViewerShell's `MobileViewerOverlay` mode switcher (since UnifiedViewer already handles mode switching). OR: don't render `MobileViewerOverlay` inside NativeViewerShell when `hideBackButton` is true (meaning parent has its own controls).

### 4. Småviken 3D Crashes
**Root cause**: From memory context, Småviken has heavy secondary models that caused persistent crashes. The xkt-cache invalidation was implemented for this. Need to check logs — the asset-plus-sync logs show "No working 3D endpoint found" which means the sync to Asset+ fails, but this shouldn't prevent loading locally cached XKT models. The crash may be a browser memory issue from loading too many large models.

**Fix**: Add error handling in `NativeXeokitViewer` to catch per-model loading failures and continue with remaining models rather than failing entirely. Also limit model loading on mobile to A-models only for large buildings.

### 5. Gunnar Not Responsive on Mobile
**Root cause**: GunnarChat renders as a fixed full-height modal (line 750-754): `h-[92vh] sm:h-[90vh]`. The embedded version (from GeminusPluginMenu) is better sized. But the main GunnarButton renders as a draggable panel with fixed dimensions. On mobile, the `GunnarChat` non-embedded mode uses `fixed inset-0 z-50` which should be full screen.

**Fix**: The Swedish text in GunnarChat needs to be translated to English. The mobile layout needs touch-optimized input area. Key areas: placeholder text (line 651), helper text (line 659-661), loading indicator (lines 706), advisor button (lines 633-643), proactive insights labels (lines 693-694).

### 6. Gunnar Shows GUIDs
**Root cause**: The system prompt explicitly says never show GUIDs (line 1494), but the building directory (lines 1417-1424) includes `fm_guid:` in the listing. While the prompt says "for YOUR reference", sometimes the AI leaks these. Also, the `search_fm_access_local` tool returns raw data with `building_fm_guid` fields. The system prompt is thorough but the AI sometimes ignores it.

**Fix**: Strip fm_guid from visible building directory text in the system prompt. Move GUIDs to a separate lookup table reference. Add post-processing in the response to strip any GUID-like patterns before showing to user.

### 7. Gunnar Says No FM Access Integration
**Root cause**: The FM Access tools (`fm_access_get_drawings`, etc.) are referenced in `executeTool` (lines 1309-1312) but the actual **tool definitions** for these are NOT in the `tools` array (lines 14-563). Only `search_fm_access_local` is defined (lines 508-526). The AI model can only call tools that are in the `tools` array. So Gunnar literally cannot call `fm_access_get_drawings` etc. — the model doesn't know they exist.

The execution functions (`execFmAccessGetDrawings`, etc.) also **don't exist** in the file — they're referenced but never defined. So even if the model tried, they'd throw undefined errors.

**Fix**: Either add tool definitions for the FM Access API tools and implement the execution functions, OR rely on `search_fm_access_local` which queries locally synced data. The simplest fix: the system prompt already mentions FM Access workflow (lines 1592-1609) — but since the tools don't exist, Gunnar uses `search_fm_access_local` instead which works fine IF the data has been synced. If no data is synced, Gunnar says "no FM Access integration". 

Best approach: Remove the phantom `fm_access_get_*` entries from `executeTool`, and enhance the system prompt to always use `search_fm_access_local` for FM Access queries. Also add `query_building_settings` lookup instructions to find `fm_access_building_guid`.

## Implementation Plan

### Files to modify:

| File | Changes |
|------|---------|
| `src/pages/UnifiedViewer.tsx` | Fix mobile 2D mode dispatch timing; avoid double mode switcher |
| `src/components/viewer/NativeViewerShell.tsx` | Accept `hideMobileOverlay` prop to prevent duplicate controls |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | No changes needed |
| `src/components/chat/GunnarChat.tsx` | Translate ALL Swedish text to English |
| `src/components/viewer/NativeXeokitViewer.tsx` | Add per-model error handling for crash resilience |
| `supabase/functions/gunnar-chat/index.ts` | Fix FM Access tool references, strip GUIDs from building directory, translate Swedish in system prompt |

### Priority order:
1. Fix 2D mode on mobile (dispatch timing + duplicate controls)
2. Fix Gunnar FM Access tools (remove phantom tools, update prompt)
3. Translate Gunnar UI to English
4. Småviken crash resilience
5. Gunnar GUID stripping

