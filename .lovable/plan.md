
# Fix AI Scanning: Bypass NavVis Storage Permission Block

## Problem

The AI scanning cannot start because the image download test in Step 1 fails. Logs confirm:
- Storage List API returns 404 for all directory patterns
- All filename pattern probes fail (GET requests blocked)
- Authentication works fine -- the account can list datasets but NOT download raw panorama files

This is a NavVis permission/tier restriction that cannot be fixed from our side.

## Solution: Browser-Based Scanning via Frontend SDK

Instead of downloading raw panorama files from the backend (which is blocked), we use the **Ivion Frontend SDK** running in the browser. The SDK already renders the 360 panoramas and has a `getScreenshot()` method that captures the current view as a data URI.

### How It Works

1. User opens AI Scan page and configures building + templates (same as today)
2. Instead of a fully automated backend scan, the system opens the 360 viewer in a controlled mode
3. The browser navigates through panorama images using `api.image.getClosestImage()` and `api.mainView.moveToImageId()`
4. At each position, `api.mainView.getScreenshot()` captures the current view
5. The captured screenshot (base64) is sent to the `ai-asset-detection` edge function for Gemini analysis
6. Detections are stored in `pending_detections` as before

```text
+--------------------+     getScreenshot()    +------------------+
|  Browser (Ivion    | -------- base64 -----> | Edge Function    |
|  SDK rendering     |                        | (Gemini Vision)  |
|  360 panoramas)    | <--- detections ------ |                  |
+--------------------+                        +------------------+
         |                                           |
         | moveToImageId()                           | INSERT
         | (auto-navigate)                           |
         v                                           v
  [Next panorama]                        [pending_detections table]
```

### Key Advantages
- Bypasses the storage permission block entirely
- Uses the same SDK already loaded for the 360 viewer
- No changes needed to NavVis account permissions
- Same AI analysis pipeline (Gemini) and review queue

### Scan Modes
- **Guided mode** (recommended): User sees the 360 viewer navigating automatically through images. They can pause/skip. More transparent.
- The viewer captures 4-6 screenshots per panorama position (rotating the view) to cover the full 360 field.

## Technical Implementation

### 1. New Component: `BrowserScanRunner.tsx`
A component that embeds the Ivion SDK viewer and orchestrates the scan:
- Loads the Ivion SDK (reuses `useIvionSdk` hook)
- Fetches the list of images/datasets from the REST API via edge function
- Iterates through images: `moveToImageId()` then waits for transition, then `getScreenshot()`
- Rotates the view 4-6 times per position to capture different angles
- Sends each screenshot to the edge function for analysis
- Shows progress overlay with current image, detections found, and pause/cancel controls

### 2. Modified: `ScanConfigPanel.tsx`
- Remove the download test requirement as a blocker
- Change "Starta AI-skanning" button to launch the browser-based scan mode
- Add a note explaining the scan runs in-browser and requires keeping the tab open

### 3. New Edge Function Action: `analyze-screenshot`
Add a lightweight action to `ai-asset-detection` that:
- Accepts a base64 screenshot + image metadata (position, orientation, imageId)
- Runs Gemini analysis (same as existing `analyzeImageWithAI`)
- Stores detections in `pending_detections`
- Returns detection count

This is simpler than the current `process-batch` because it receives a single pre-captured image instead of trying to download from NavVis.

### 4. Modified: `ScanProgressPanel.tsx`
- Support the new browser-based scan mode (progress comes from the component, not polling the DB)
- Show "Skanning kors i webblasaren -- hall fliken oppen" notice

### 5. Modified: `AiAssetScan.tsx`
- Add state for browser scan mode
- When scan starts, switch to a view that shows the embedded Ivion viewer + scan progress overlay

## Files to Create/Modify

| File | Change |
|---|---|
| `src/components/ai-scan/BrowserScanRunner.tsx` | **New** -- Ivion SDK viewer + auto-scan orchestration |
| `src/components/ai-scan/ScanConfigPanel.tsx` | Remove download test as blocker, launch browser scan |
| `src/components/ai-scan/ScanProgressPanel.tsx` | Support browser-based progress reporting |
| `src/pages/AiAssetScan.tsx` | Add browser scan mode state and view |
| `supabase/functions/ai-asset-detection/index.ts` | Add `analyze-screenshot` action |

## Scope Notes

- The existing review queue (`DetectionReviewQueue`) and template management remain unchanged
- Detection coordinate projection will use the image's known position from the SDK (`image.location`) instead of poses.csv
- The scan is slower than a pure backend approach (limited by browser rendering) but works reliably without storage permissions
