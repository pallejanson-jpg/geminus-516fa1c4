

# Fix API Settings Responsiveness, ACC Region Logic, and 3D Conversion

## Issue 1: API Settings Responsiveness

The dialog uses `sm:max-w-2xl` with 7 tabs crammed into a `grid-cols-7`, causing text to be cut off on narrow screens. Buttons in the ACC section also overflow horizontally.

### Changes

**File: `src/components/settings/ApiSettingsModal.tsx`**

- Widen the dialog: change `sm:max-w-2xl` to `sm:max-w-3xl` to give more breathing room
- Change the TabsList from `grid-cols-7` to a horizontally scrollable `flex` layout so tabs don't compress on small screens
- Add `overflow-x-auto` and `whitespace-nowrap` to the TabsList container
- In the ACC section, wrap the action buttons (`flex-wrap`) and ensure they stack vertically on mobile using `flex-col sm:flex-row`
- Make the folder browser `max-h` slightly larger on desktop and add horizontal scroll for long file names
- Ensure the AccFolderNode items don't overflow by adding `overflow-hidden` and `min-w-0` to text containers

---

## Issue 2: ACC Region Not Controlling Folder Fetches

The root cause: `list-folders` uses `ACC_ACCOUNT_ID` to construct the hub ID (`b.{accountId}`), and this is a single value. The Autodesk Data Management API scopes folders to a specific hub. If the hub belongs to an EMEA account, changing the region header to US won't make it return US folders -- the hub itself determines which data center and which projects are visible.

**The fix needs to support separate US and EMEA account IDs**, or alternatively let the user specify an Account ID alongside the region switch.

### Changes

**File: `supabase/functions/acc-sync/index.ts`**

- In `list-projects` and `list-folders` actions: check for `ACC_ACCOUNT_ID_US` and `ACC_ACCOUNT_ID_EMEA` environment variables alongside the existing `ACC_ACCOUNT_ID`
- When `region === 'US'`, prefer `ACC_ACCOUNT_ID_US`, fall back to `ACC_ACCOUNT_ID`
- When `region === 'EMEA'`, prefer `ACC_ACCOUNT_ID_EMEA`, fall back to `ACC_ACCOUNT_ID`
- Log which account ID and region is being used for each request
- In `list-folders` and `list-projects`, also save the used region to the cache so it persists

**File: `src/components/settings/ApiSettingsModal.tsx`**

- Add a clear label next to the region switch showing which Account ID (abbreviated) is being used for the selected region
- When region changes, automatically clear the folder cache (`setAccFolders(null)`) so stale EU/US data isn't shown
- After switching region, if folders were previously loaded, show a hint to re-fetch

---

## Issue 3: 3D Conversion Error (Red Box)

The pipeline requests SVF2 format from the Model Derivative API (line 1828: `{ type: "svf2", views: ["3d"] }`), but the client-side converter uses `parseGLTFIntoXKTModel` which expects GLB/glTF data. SVF2 is Autodesk's proprietary format and cannot be parsed as glTF -- this causes the red error box.

### Solution: Request OBJ format instead of SVF2

The Autodesk Model Derivative API supports OBJ output, and `@xeokit/xeokit-convert` can parse OBJ via `parseGLTFIntoXKTModel` if provided as binary. However, the cleanest approach is:

1. Keep SVF2 for the Autodesk Viewer (if ever needed)
2. Additionally request OBJ output format for XKT conversion
3. In `download-derivative`, prefer OBJ derivatives over SVF2
4. In the client-side converter, detect the file format (OBJ vs GLB) and use the appropriate parser

### Changes

**File: `supabase/functions/acc-sync/index.ts`** -- `translate-model` action

- Change output formats to include OBJ: `formats: [{ type: "svf2", views: ["3d"] }, { type: "obj" }]`
- Update `output_format` in the DB record to `"svf2,obj"`
- Log the translation request body for debugging

**File: `supabase/functions/acc-sync/index.ts`** -- `download-derivative` action

- In the derivative selection logic, prefer OBJ derivatives (mime `application/octet-stream` with `.obj` extension or `obj` output type)
- Log the available derivative formats so we can debug what Autodesk actually provides
- Add format metadata to the response so the client knows what it downloaded

**File: `src/services/acc-xkt-converter.ts`**

- In `convertGlbToXkt`, add file format detection:
  - Check first 4 bytes for GLB magic (`glTF` = `0x46546C67`)
  - Check first bytes for OBJ signature (`#` or `v `)
  - If SVF2 (neither GLB nor OBJ), throw a clear error: "SVF2-format stods inte for klientkonvertering. Kontakta support."
- Add an `parseOBJIntoXKTModel` path if `@xeokit/xeokit-convert` supports it (check available exports)
- Improve error messages to show what format was detected vs expected

---

## Files to Modify

| File | Changes |
|---|---|
| `src/components/settings/ApiSettingsModal.tsx` | Widen dialog, scrollable tabs, responsive button layout, clear folders on region change |
| `supabase/functions/acc-sync/index.ts` | Region-specific Account IDs, OBJ output format in translate-model, derivative format logging |
| `src/services/acc-xkt-converter.ts` | File format detection, OBJ parser support, better error messages |

## Expected Results

- Settings modal is usable on narrow screens without overflow
- Switching US/EMEA fetches folders from the correct hub
- 3D conversion either succeeds (with OBJ format) or shows a clear diagnostic error instead of a generic red box
