# GEMINUS — Code Review Checklist

Generated: 2026-05-25

---

## 🔴 High Priority

### 1. `ProtectedRoute` doesn't actually protect routes
**File:** `src/components/auth/ProtectedRoute.tsx:10`

The component declares a `requireAdmin` prop but ignores it. More critically, once `isLoading` is false it renders `children` unconditionally — no auth check at all. Any unauthenticated user who lands on a protected route will see it in full.

This is intentional for now (auth is disabled), but the contract is misleading. The `requireAdmin` prop is dead code.

**Fix when re-enabling auth:**
```tsx
// After loading, redirect if not authenticated
if (!isLoading && !user) {
  return <Navigate to="/login" replace />;
}
```

---

### 2. Module-level mutable credential state in Edge Function
**File:** `supabase/functions/asset-plus-sync/index.ts:18-26`

```ts
let _creds = { apiUrl: '', apiKey: '', ... };
```

Deno isolates *can* be reused across requests. If request A sets `_creds` to Building X's credentials and the isolate is reused for request B before `_creds` is overwritten, request B could use the wrong credentials. This is a data-isolation risk.

**Fix:** Pass credentials as function arguments rather than module-level state, or at minimum reset `_creds` to empty defaults at the *start* of every request handler, before reading from `building_settings`.

---

## 🟡 Medium Priority

### 3. Polling loop doesn't cancel on unmount
**File:** `src/components/common/DataConsistencyBanner.tsx:84-113`

`runLoop()` uses `setTimeout(() => runLoop(), 2000)` with no way to stop it. If the user navigates away while a sync is in progress, the loop keeps running and calls `setSyncSteps` / `setSyncOutcome` on the unmounted component (React warning: "Can't perform state update on unmounted component").

**Fix:**
```tsx
const cancelledRef = useRef(false);
useEffect(() => () => { cancelledRef.current = true; }, []);

// Inside runLoop:
if (cancelledRef.current) return;
setTimeout(() => runLoop(), 2000);
```

---

### 4. `ApiSettingsModal.tsx` is 3,793 lines — God component
**File:** `src/components/settings/ApiSettingsModal.tsx`

A single component this size is very hard to maintain, test, and reason about. Every state change re-renders the entire tree. Each tab (Asset+, ACC, FM Access, XKT Sync, etc.) should be its own component with its own state.

**Suggested split:**
- `AssetPlusTab.tsx`
- `AccSyncTab.tsx`
- `FmAccessTab.tsx`
- `XktSyncTab.tsx`
- `ApiSettingsModal.tsx` becomes a thin shell (~100 lines)

---

### 5. Silent `getAccessToken` retry hides failure details
**File:** `supabase/functions/asset-plus-sync/index.ts:66-83`

The first Keycloak attempt fails and the error is swallowed before retrying without `client_secret`. You lose the actual failure reason (wrong password vs wrong URL vs network error).

```ts
// Log before retrying
console.warn("Keycloak auth with client_secret failed, retrying as public client");
```

---

## 🟢 Low Priority / Style

### 6. `Login.tsx` renders dead UI before redirecting
**File:** `src/pages/Login.tsx:10-12`

The `useEffect` immediately navigates away on mount, but the full JSX still runs (including loading the `chicagoHero` image). The page is never actually seen.

If auth is permanently disabled, this file can be simplified to just `return null` with the redirect. If you plan to re-enable auth, keep the UI but remove the auto-redirect.

---

### 7. `err: any` type is used throughout
**Files:** `DataConsistencyBanner.tsx`, `asset-plus-sync/index.ts`

```ts
} catch (err: any) {
  // err.message is unsafe if err is not an Error
```

**Prefer:**
```ts
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
```

---

### 8. Commented-out auto-check code
**File:** `src/components/common/DataConsistencyBanner.tsx:203-207`

The old `useEffect` for `checkDelta` is commented out with a note. Once you're confident in the manual-sync approach, delete it so it doesn't confuse future readers.

---

### 9. `requireAdmin` prop is declared but never used
**File:** `src/components/auth/ProtectedRoute.tsx:5-10`

Remove it from the interface until it's actually implemented, or the type contract promises something the code doesn't deliver.

---

## Summary

| # | Issue | File | Severity |
|---|-------|------|----------|
| 1 | ProtectedRoute doesn't check auth | `ProtectedRoute.tsx` | 🔴 High |
| 2 | Module-level credential state in Edge Fn | `asset-plus-sync/index.ts` | 🔴 High |
| 3 | Polling loop not cancelled on unmount | `DataConsistencyBanner.tsx` | 🟡 Medium |
| 4 | God component (3,793 lines) | `ApiSettingsModal.tsx` | 🟡 Medium |
| 5 | Silent retry hides auth failure reason | `asset-plus-sync/index.ts` | 🟡 Medium |
| 6 | Login renders dead UI before redirect | `Login.tsx` | 🟢 Low |
| 7 | `err: any` unsafe catch typing | Multiple | 🟢 Low |
| 8 | Commented-out dead code | `DataConsistencyBanner.tsx` | 🟢 Low |
| 9 | Unused `requireAdmin` prop | `ProtectedRoute.tsx` | 🟢 Low |
