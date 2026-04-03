

# Remove automatic XKT staleness check from viewer startup

## What and why
You want the viewer to start as fast as possible. The current `deferStalenessCheck` runs a background sync call to Asset+ after every viewer open if models are older than 7 days. This adds unnecessary network overhead on startup. Instead, XKT sync should only happen when the user explicitly triggers it in Settings (which already has a "Sync XKT" button via `ApiSettingsModal`).

## Changes

### 1. Remove `deferStalenessCheck` from `useModelLoader.ts`
- Delete the `deferStalenessCheck` callback (lines 430-448)
- Remove it from the hook's return object

### 2. Remove the call in `NativeXeokitViewer.tsx`
- Delete the `deferStalenessCheck(models)` call at the end of the `initialize` function
- Remove `deferStalenessCheck` from the destructured hook imports

That's it — two small deletions. The existing "Sync XKT" button in Settings already calls `sync-xkt-resumable` and handles per-building sync, so users retain full control over when to pull fresh models from Asset+.

