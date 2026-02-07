

# Fix Split View Sync and XKT Caching

## Problem Summary

Two separate issues prevent Split View sync and fast 3D loading:

1. **Split View windows don't follow each other** - The NavVis SDK package (`@navvis/ivion`) was uploaded but never added to `package.json`. The system always falls back to iframe mode, which has no real-time camera synchronization.

2. **XKT models load from Asset+ every time** - The cache-on-load mechanism fails silently because:
   - The `xkt-models` storage bucket is missing INSERT and UPDATE policies (uploads are blocked by security rules)
   - The upload code passes raw `ArrayBuffer` to the storage client, which causes a JSON parsing error on the response for large binary files (~23 MB)
   - Result: 0 models have ever been cached in the database

## Fix Plan

### Fix 1: Install NavVis SDK package

**File: `package.json`**
- Add `"@navvis/ivion": "file:navvis-ivion-11.9.8.tgz"` to the `dependencies` section
- The uploaded `.tgz` file needs to be copied from the user upload location to the project root

No other code changes needed -- `src/lib/ivion-sdk.ts` already uses `import('@navvis/ivion')` with automatic fallback, and `Ivion360View.tsx` already handles the SDK/iframe mode switch.

### Fix 2: Add storage policies for XKT models

**Database migration** -- Add missing storage policies:

```sql
-- Allow authenticated users to upload XKT models
CREATE POLICY "Authenticated users can upload XKT models"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'xkt-models');

-- Allow authenticated users to update XKT models (needed for upsert)
CREATE POLICY "Authenticated users can update XKT models"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'xkt-models');
```

### Fix 3: Fix binary upload data format

**File: `src/services/xkt-cache-service.ts`**

In the `saveModelFromViewer` method (around line 263), wrap the `ArrayBuffer` in a `Blob` before uploading:

```typescript
// Before (broken):
const { error: uploadError } = await supabase.storage
  .from('xkt-models')
  .upload(storagePath, xktData, {
    contentType: 'application/octet-stream',
    upsert: true,
  });

// After (fixed):
const blob = new Blob([xktData], { type: 'application/octet-stream' });
const { error: uploadError } = await supabase.storage
  .from('xkt-models')
  .upload(storagePath, blob, {
    contentType: 'application/octet-stream',
    upsert: true,
  });
```

Also fix the same issue in the `storeModel` method, which sends base64-encoded data through an edge function. This path is less critical since `saveModelFromViewer` is the primary cache mechanism, but wrapping binary data in a `Blob` ensures consistency.

### Fix 4: Fix signed URL expiry in database

The current code stores a signed URL (with 24-hour expiry) in the `file_url` column of `xkt_models`. After 24 hours, these URLs become invalid. The `checkCache` method should regenerate signed URLs from `storage_path` when `file_url` returns a failed fetch, or we should simply not store signed URLs and always generate them on demand.

**File: `src/services/xkt-cache-service.ts`**

In `checkCache`, when a match is found with `file_url`, validate it's still accessible. If not, regenerate from `storage_path`. This is a minor optimization but prevents stale URL issues.

## Technical Details

### Files changed

| File | Change |
|------|--------|
| `package.json` | Add `@navvis/ivion` dependency |
| `navvis-ivion-11.9.8.tgz` | Copy from uploads to project root |
| Database migration | Add INSERT + UPDATE policies for `xkt-models` storage |
| `src/services/xkt-cache-service.ts` | Wrap ArrayBuffer in Blob for upload; improve signed URL handling |

### Expected behavior after fix

1. **Split View**: SDK loads successfully, `renderMode` becomes `'sdk'`, bi-directional camera polling activates. Moving in 360 view updates 3D view and vice versa.

2. **XKT Caching**: First load fetches from Asset+ and caches the binary to storage (~23 MB upload). Subsequent loads serve from memory cache (instant) or storage cache (fast signed URL). The database tracks cached models per building.

3. **Cache flow**:

```text
User opens 3D viewer
  |
  +-- fetch interceptor detects XKT request
  +-- Check memory cache --> HIT? Return instantly
  +-- Check database cache --> HIT? Fetch from storage, store in memory
  +-- MISS? Fetch from Asset+ API
       +-- Store in memory cache
       +-- Background: Upload Blob to storage bucket
       +-- Background: Save metadata to xkt_models table
```

