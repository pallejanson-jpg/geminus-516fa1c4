

## Analysis: Smedvig Viewer — Why Nothing Is Shown

### Root Cause 1: XKT Compression Mismatch (0 entities)

The console logs clearly show:
```
[NativeViewer] Loading from memory: slot-ark, size: 17906888
[NativeViewer] Skipping empty/orphan model: slot-ark (0 entities)
```

The 17MB XKT file loads without error, but xeokit reports **0 entities**. This is because the browser-based converter in `acc-xkt-converter.ts` line 284 writes:

```ts
const xktArrayBuffer = writeXKTModelToArrayBuffer(xktModel, null, stats, { zip: false });
```

The `{ zip: false }` flag produces **uncompressed** XKT data. However, the xeokit SDK's V10/V11/V12 parsers expect **zlib-compressed** arrays. When the parser tries to decompress uncompressed data, it silently produces empty typed arrays → **0 entities**.

Both `slot-ark` (ARK, 17MB) and `ifc-1774617999007` (RIV, 17MB) were converted with `zip: false`, so both are broken.

**Fix**: Change `{ zip: false }` to `{ zip: true }` (or remove the option entirely — compression is the default). Both IFC models will need to be re-imported after the fix.

### Root Cause 2: Model Slot Dialog Not Showing

The dialog in `handleIfcUpload` (line 889) only triggers if:
```ts
const isUploadToExisting = !createdBuilding && existingBuildings.some(b => b.fmGuid === targetBuildingFmGuid);
if (isUploadToExisting && availableModelSlots.length > 0) { ... }
```

If `createdBuilding` is still set from a previous session (state not cleared), `isUploadToExisting` evaluates to `false`, and the dialog is skipped entirely — going straight to `startIfcUpload(inferredIfcModelName)` which uses the filename as model name instead of letting the user pick an existing slot (ARK/RIV).

This also explains why the RIV model ended up with `model_id: ifc-1774617999007` instead of `slot-riv` — the slot dialog was bypassed.

**Fix**: Always show the slot dialog when `availableModelSlots.length > 0`, regardless of `createdBuilding` state. Simplify the condition to:
```ts
if (availableModelSlots.length > 0) { ... }
```

### Implementation Plan

1. **Fix XKT compression** — In `src/services/acc-xkt-converter.ts`, change `{ zip: false }` to `{ zip: true }` so browser-converted XKT files are compatible with xeokit's parsers.

2. **Fix slot dialog condition** — In `src/components/settings/CreateBuildingPanel.tsx`, remove the `!createdBuilding` guard so the model slot selection dialog always appears when existing models are present, letting the user choose ARK or RIV.

3. After deploying: user will need to **re-import** ARK and RIV IFC files for Smedvig (selecting correct slots), since the existing XKT files were generated with `zip: false` and are unreadable.

### Technical Details

| Item | File | Line | Change |
|------|------|------|--------|
| XKT compression | `src/services/acc-xkt-converter.ts` | 284 | `{ zip: false }` → `{ zip: true }` |
| Slot dialog guard | `src/components/settings/CreateBuildingPanel.tsx` | 888-889 | Remove `!createdBuilding &&` from condition |

