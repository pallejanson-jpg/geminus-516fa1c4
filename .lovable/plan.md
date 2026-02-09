

# AI Scanning Improvements: Sidebar Integration, Pre-selection, and UI Polish

## Changes Overview

### 1. Add AI Scanning as a Sidebar App

Add `ai_scan` as a new entry in the sidebar app system so it appears alongside the other apps.

**`src/lib/constants.ts`**:
- Add `ai_scan` to `DEFAULT_APP_CONFIGS` with label `AI Scan`, icon `Scan`
- Add `{ id: 'ai_scan', hasDividerAfter: false }` to `DEFAULT_SIDEBAR_ORDER` (after `inventory`)

**`src/components/layout/LeftSidebar.tsx`**:
- Add `ai_scan` to `SIDEBAR_ITEM_META` with `Scan` icon, `text-emerald-500` color, type `'internal'`

**`src/components/layout/MainContent.tsx`**:
- Add `case 'ai_scan'` that renders `<AiAssetScan />` (lazy loaded) inline, inside the app layout instead of navigating to `/inventory/ai-scan`

**`src/components/settings/AppMenuSettings.tsx`**:
- Add `ai_scan` entry to `SIDEBAR_ITEM_META`

### 2. Pre-select All Templates by Default

**`src/components/ai-scan/ScanConfigPanel.tsx`**:
- On initial load, set `selectedTemplates` to contain all active template `object_type` values instead of starting empty
- Add a `useEffect` that populates `selectedTemplates` when `templates` prop changes and selection is empty

### 3. Pre-select Building When Launched from Building Context

**`src/pages/AiAssetScan.tsx`** (or `ScanConfigPanel.tsx`):
- Accept an optional `preselectedBuildingGuid` prop
- When provided, auto-set `selectedBuilding` to that value on mount
- The `MainContent.tsx` integration can pass the current `selectedFacility?.fm_guid` from AppContext

### 4. Improve Desktop UI Layout

**`src/pages/AiAssetScan.tsx`**:
- Replace `overflow-hidden` with `overflow-auto` on the root container so the page scrolls vertically
- Use a max-width container (`max-w-4xl mx-auto`) for desktop to prevent cards from stretching too wide
- Remove the restrictive `h-full` + `flex-col` + `min-h-0` stacking that causes the start button to be hidden

**`src/components/ai-scan/ScanConfigPanel.tsx`**:
- Restructure the layout so on desktop (md+), building selection and template selection sit side-by-side in a 2-column grid (`grid grid-cols-1 md:grid-cols-2 gap-4`)
- The info card and start button stay full-width below
- Remove `h-full` / `flex-1 overflow-auto` constraints -- let the content flow naturally and page-level scroll handle overflow
- Make the start button always visible at the bottom without needing `sticky` by ensuring the content fits better

**`src/components/ai-scan/BrowserScanRunner.tsx`**:
- Apply `bg-background` to match theme
- Ensure the viewer container uses `flex-1` within the page so it fills available space

### 5. Fix SDK Initialization Hang

The "360-visaren kunde inte laddas" error occurs because the Ivion SDK fails to initialize. The current flow:
1. Container renders with `min-h-[400px]` and `h-[50vh]`
2. SDK polls for dimensions, enables, then starts loading
3. SDK loads via `loadIvionSdk` which creates `<ivion>` element and calls `getApi()`
4. `getApi()` times out or fails silently

Root cause investigation: The `loadIvionSdk` function temporarily injects `?site=` into the URL, which can cause React Router to remount components. Combined with the concurrent load guard (`activeLoadPromise`), a failed first attempt can block retries.

**`src/components/ai-scan/BrowserScanRunner.tsx`**:
- Add more robust error logging: capture and display the actual error message from `useIvionSdk` failure
- On retry, ensure `activeLoadPromise` is cleared by calling `retry()` which already handles cleanup
- Increase the timeout slightly and add a visible countdown so users know something is happening
- Show the actual SDK status transitions in the UI (e.g., "Laddar SDK...", "Autentiserar...", "Ansluter till site...")

**`src/hooks/useIvionSdk.ts`**:
- Add error state tracking so the actual error message propagates to consumers (currently only `sdkStatus: 'failed'` is returned with no detail)
- Return `errorMessage` alongside `sdkStatus`

## Files to Create/Modify

| File | Change |
|---|---|
| `src/lib/constants.ts` | Add `ai_scan` to `DEFAULT_APP_CONFIGS` and `DEFAULT_SIDEBAR_ORDER` |
| `src/components/layout/LeftSidebar.tsx` | Add `ai_scan` to `SIDEBAR_ITEM_META` |
| `src/components/layout/MainContent.tsx` | Add `case 'ai_scan'` rendering `AiAssetScan` |
| `src/components/settings/AppMenuSettings.tsx` | Add `ai_scan` to settings meta |
| `src/pages/AiAssetScan.tsx` | Accept `preselectedBuildingGuid`, fix layout for scroll and desktop |
| `src/components/ai-scan/ScanConfigPanel.tsx` | Pre-select all templates, 2-column desktop layout, remove sticky hack |
| `src/components/ai-scan/BrowserScanRunner.tsx` | Better error display, theme-aware background |
| `src/hooks/useIvionSdk.ts` | Expose `errorMessage` from SDK failures |

