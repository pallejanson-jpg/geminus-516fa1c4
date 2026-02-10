

# Fix Fault Report: API Discovery, Photo Attachments

## Problem 1: API returns 404

The edge function calls `https://er-rep.com/api/v1/errorreport/register/{key}` but gets a 404. The correct API path is unknown and the site blocks scraping.

### Solution: Add API path discovery to the edge function

Update the `errorreport-proxy` edge function to try multiple common API path patterns when `get-config` is called, and return the first one that succeeds. This is a one-time discovery -- once found, the working path is cached in the response.

**Paths to try (in order):**
1. `/api/v1/errorreport/register/{key}` (current)
2. `/api/errorreport/register/{key}`
3. `/api/v1/errorreport/{key}`
4. `/api/errorreport/{key}`
5. `/{key}` (the public URL path itself, with `Accept: application/json` header)

The edge function will log each attempt and its status code. When one returns 200, that path is used. The working path pattern is returned in the response so we can hardcode it once discovered.

**File: `supabase/functions/errorreport-proxy/index.ts`**

- Add a `discoverApiPath` helper that tries multiple URL patterns
- Log each attempt with status code
- For the `get-config` action, use discovery instead of a single hardcoded path
- For the `submit` action, use the same discovered path pattern
- Return `_discoveredPath` in the response for debugging

## Problem 2: Photos not included in submission

Currently, `PhotoCapture` uploads images to Supabase Storage and returns public URLs. When submitting to er-rep.com, the code sends `attachments: []` (empty). The external API likely expects base64-encoded image data, not Supabase URLs.

### Solution: Convert photos to base64 on the client side

Since edge functions cannot fetch from the preview server, photo data must be converted to base64 in the browser before submission.

**File: `src/components/fault-report/PhotoCapture.tsx`**

- In addition to uploading to storage (for local work orders), also store the base64 data of each photo in state
- Use `FileReader.readAsDataURL` to capture base64 when the file is selected
- Expose both `photos` (URLs for display) and `photoData` (base64 for API submission)

Alternative (simpler): Change `PhotoCapture` to keep base64 data alongside URLs.

**File: `src/pages/FaultReport.tsx`**

- Track `photoBase64` state alongside `photos` URLs
- When `qrKey` is present (external API mode), include base64 data in the `attachments` array of the payload
- Clean base64 strings (remove `data:image/...;base64,` prefix, strip whitespace)

**File: `src/components/fault-report/FaultReportForm.tsx` and `MobileFaultReport.tsx`**

- Update `PhotoCapture` usage to pass through base64 callback
- Update `onSubmit` signature to include photo base64 data

### Payload format for attachments:
```text
attachments: [
  {
    fileName: "photo1.jpg",
    mimeType: "image/jpeg",
    data: "base64-string-here..."
  }
]
```

## Problem 3: Better error handling

The current error message "Kunde inte lasa QR-koden. Forsok igen." is misleading -- it's not a QR code reading issue, it's an API error. 

**File: `src/pages/FaultReport.tsx`**

- Change the error message to be more specific: show the HTTP status code if available
- Add a "Retry" button on the error screen instead of a dead end
- If 404, show: "Kunde inte hitta installationen. Kontrollera att QR-koden ar giltig."

## Technical Summary

| File | Changes |
|---|---|
| `supabase/functions/errorreport-proxy/index.ts` | Add API path discovery with multiple URL patterns; log each attempt |
| `src/pages/FaultReport.tsx` | Track photo base64 data; include in attachments payload; improve error messages with retry button |
| `src/components/fault-report/PhotoCapture.tsx` | Capture base64 data alongside URL when files are selected; expose via callback |
| `src/components/fault-report/FaultReportForm.tsx` | Pass through photo base64 data from PhotoCapture to onSubmit |
| `src/components/fault-report/MobileFaultReport.tsx` | Same changes as FaultReportForm for mobile layout |

## Expected Result

- Edge function discovers the correct API path and logs it
- Photos are converted to base64 client-side and sent as attachments
- Error screen shows a meaningful message and a retry button
- Once the correct API path is found, it can be hardcoded for performance

