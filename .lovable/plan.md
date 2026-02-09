

# Fix Text Colors, Point-Picker Bug, and UX Improvements

## 1. Text Color Issues in Right Panel ("Visning") and Alignment Panel

The right panel uses `text-foreground/70` and `text-foreground/60` for labels and descriptions. In dark mode these become very hard to read. The Alignment Panel uses `text-muted-foreground` which is similarly low-contrast.

### Changes in `src/components/viewer/ViewerRightPanel.tsx`
- Replace all `text-foreground/60` with `text-foreground/70` (minimum)
- Ensure section labels like "Klipphöjd", "Takklipp", etc. use `text-foreground` (not `/70`)
- Description/help texts keep `text-foreground/70` but not lower

### Changes in `src/components/viewer/AlignmentPanel.tsx`
- Change label text from `text-muted-foreground` to `text-foreground/70` for better contrast on dark backgrounds
- Ensure the help text box and crosshair toggle labels are readable

## 2. Point-Picker Broken: `api.getMainView is not a function`

### Root Cause
Console log confirms: `TypeError: api.getMainView is not a function`. The `ivApiRef.current` passed to `AlignmentPointPicker` does NOT contain the actual Ivion API at the time of the click. This could be because:
- The ref holds an intermediate object (e.g., the SDK's `getApi` wrapper rather than the resolved API)
- Or the SDK resolved but the ref was overwritten during a re-render cycle

The same ref works correctly in `useIvionCameraSync` (line 188), which means `getMainView()` IS available on the real API. The fix is to add a defensive check and log the actual ref contents so we can verify what's there, plus add a user-visible error toast instead of failing silently.

### Fix in `src/components/viewer/AlignmentPointPicker.tsx`
- Add a guard: if `api.getMainView` doesn't exist, show a toast error "SDK ej redo" to the user
- Log `Object.keys(api)` to help debug what the ref actually contains
- Also try the fallback approach: read position from the image cache using the current URL's `image=` parameter (the user is on the split-viewer page which has `&image=520610592820634` in the URL)

## 3. Point-Picker UX: Clearer Step-by-Step Guidance

The user was confused because after clicking "Fanga position" (which failed silently), nothing happened and Step 2 still said "Fanga 360-position forst". The UX needs:

### Changes in `src/components/viewer/AlignmentPointPicker.tsx`
- **Step 1 description**: Change to "Navigera i 360-vyn till en punkt du kan identifiera i 3D (t.ex. ett horn, dorr eller pelare). Tryck sedan Fanga position."
- **Step 1 button**: After capture, show a green success message with coordinates
- **Step 1 error**: If capture fails, show a red error message: "Kunde inte lasa position fran 360-vyn. SDK kan vara under laddning." with a retry button
- **Step 2 description**: When active, show: "Klicka nu pa EXAKT samma punkt i 3D-modellen till vanster. Klicka direkt pa ytan (vagg, golv, dorr)."
- **Step 2 waiting state**: Show a more prominent pulsing indicator: "Vantar pa att du klickar i 3D-vyn..."
- **Step 3 (done)**: Show both coordinates side by side and the calculated offset before applying
- Add error handling with user-visible toast for failures

## Summary of Files to Modify

| File | Changes |
|---|---|
| `src/components/viewer/ViewerRightPanel.tsx` | Fix text contrast: replace `text-foreground/60` with `text-foreground/70`, ensure labels are readable |
| `src/components/viewer/AlignmentPanel.tsx` | Fix label text colors for dark mode readability |
| `src/components/viewer/AlignmentPointPicker.tsx` | Fix `getMainView` error with guard + fallback, improve UX with clearer instructions, error states, and toast messages |

