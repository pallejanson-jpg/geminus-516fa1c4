

## Fix: XKT Cache Staleness for Akerselva Atrium

### Problem

The cached XKT models for Akerselva Atrium (`a8fe5835`) were synced on 2026-02-13, only 3 days ago. The current staleness check uses a 7-day threshold on `synced_at`, so these models pass the freshness check and are served from cache -- even though Asset+ has newer versions.

The root cause is two-fold:
1. `source_updated_at` is never populated -- `saveModelFromViewer` stores `new Date().toISOString()` as `source_updated_at` (the current time), not the actual source model's last-modified date
2. The staleness logic only checks age-based expiry (7 days), not whether the source has actually changed

### Solution

**A) Capture the `Last-Modified` header from Asset+ responses during Cache-on-Load**

When the fetch interceptor downloads a fresh XKT from Asset+, extract the `Last-Modified` response header and pass it to `saveModelFromViewer`. This gives us the actual source timestamp to compare against later.

**Changes to `AssetPlusViewer.tsx` (interceptor, ~line 2683):**
- After `response.clone()`, extract `Last-Modified` header from the response
- Pass it as a new parameter `sourceLastModified` to `saveModelFromViewer`

**Changes to `xkt-cache-service.ts` (`saveModelFromViewer`):**
- Add optional `sourceLastModified?: string` parameter
- Store it as `source_updated_at` instead of `new Date().toISOString()`
- If no header is available, store the current time as fallback

**B) Compare `source_updated_at` against fresh Asset+ metadata before serving cache**

When the interceptor finds a database cache hit, do a lightweight `HEAD` request to the original Asset+ URL to get the current `Last-Modified`. If it's newer than `source_updated_at`, skip the cache.

**Changes to `AssetPlusViewer.tsx` (interceptor, ~line 2652):**
- When `checkCache` returns a hit (not stale by age), do a `HEAD` request to the original XKT URL
- Compare the response's `Last-Modified` against the cached `source_updated_at`
- If the source is newer, log "Source updated, fetching fresh" and skip cache
- If HEAD fails or has no Last-Modified, fall through to the age-based check as before

**C) Fix `saveModelFromViewer` duplicate check -- allow updates**

Currently, `saveModelFromViewer` early-returns if `count > 0` in the database, meaning a stale-then-refreshed model never gets updated. When we fetch fresh because of staleness, we need to update the existing entry.

**Changes to `xkt-cache-service.ts` (`saveModelFromViewer`, ~line 242):**
- Remove the early `return true` when model exists in database
- Instead, let the upsert logic (which already has `onConflict`) handle updates
- This ensures that when a stale model is re-fetched, the new data and timestamps overwrite the old entry

**D) Return `source_updated_at` from `checkCache` for comparison**

**Changes to `xkt-cache-service.ts` (`checkCache`):**
- Include `source_updated_at` in the return type so the interceptor can use it for HEAD comparison

---

### Technical Details

**Interceptor flow after fix:**

```text
XKT request intercepted
  -> Check memory cache -> if hit, return immediately
  -> Check database cache (checkCache)
     -> If hit and NOT age-stale:
        -> HEAD request to original Asset+ URL
        -> Compare Last-Modified vs source_updated_at
        -> If source is newer: skip cache, fetch fresh, update cache
        -> If same or older: serve from cache
     -> If hit and age-stale (>7 days):
        -> Skip cache, fetch fresh, update cache
     -> If miss:
        -> Fetch from Asset+, save to cache
```

**HEAD request pattern:**
```typescript
try {
  const headResp = await original(url, { method: 'HEAD' });
  const sourceLastMod = headResp.headers.get('Last-Modified');
  if (sourceLastMod && cacheResult.sourceUpdatedAt) {
    const sourceDate = new Date(sourceLastMod).getTime();
    const cachedDate = new Date(cacheResult.sourceUpdatedAt).getTime();
    if (sourceDate > cachedDate) {
      console.log(`XKT cache: Source newer than cache for ${modelId}`);
      // Fall through to fresh fetch below
    }
  }
} catch { /* HEAD failed, use age-based check */ }
```

**Files to modify:**
- `src/components/viewer/AssetPlusViewer.tsx` -- interceptor logic
- `src/services/xkt-cache-service.ts` -- `checkCache` return type, `saveModelFromViewer` parameters and duplicate check

**No database migration needed** -- `source_updated_at` column already exists (added in previous migration).

