

## Problem

The XKT model sync from Asset+ skips re-downloading models due to overly aggressive cache logic on lines 1765-1776 of `asset-plus-sync/index.ts`:

1. **Line 1767-1769**: If the stored `source_updated_at` matches the `revisionId`, it skips -- this is correct behavior.
2. **Line 1771-1773**: If there's NO `revisionId` from the API but the model was previously synced (`storedRevision` exists), it skips with "no revision info to compare". **This is the bug.** When the revision API returns empty or incomplete data, every previously-synced model gets skipped permanently, even if the actual XKT file has been updated on the server.

## Fix

**File: `supabase/functions/asset-plus-sync/index.ts`** (lines 1765-1776)

Remove the fallback skip on line 1771-1774. When there's no revision info available from the API, the sync should always re-download the model to ensure freshness. The only valid skip condition is when both revisionIds exist and match.

Updated logic:
```
if (existingModel && !forceSync) {
  if (revisionId && storedRevision === revisionId) {
    // Both sides have revision IDs and they match → skip
    continue;
  }
  // Otherwise: no revision info OR mismatch → always re-download
}
```

This is a single-line deletion (remove the `if (!revisionId && storedRevision)` block). No other files need changes.

