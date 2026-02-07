

# Full Ivion SDK Integration with loginToken Authentication

## Background

The Split View needs the NavVis Frontend API SDK for bi-directional camera synchronization. Currently the SDK loading fails because:
1. The Ivion instance may not have CORS configured for our domain
2. Even if the SDK loads, the user would need to manually log into Ivion in the rendered viewer

The NavVis Frontend API supports a `loginToken` parameter in the `ConfigurationInterface` passed to `getApi()`, which automatically authenticates the user without requiring manual login. We already have backend token management in `ivion-auth.ts`.

## Solution Overview

```text
+-------------------+       1. Request loginToken        +-------------------+
|                   | ---------------------------------> |                   |
|   Ivion360View    |                                    |   ivion-poi       |
|   (Frontend)      | <--------------------------------- |   Edge Function   |
|                   |       2. Return JWT token           |                   |
+-------------------+                                    +-------------------+
         |                                                        |
         | 3. getApi(baseUrl, { loginToken })                     | Uses ivion-auth.ts
         v                                                        | (cached tokens,
+-------------------+                                            | refresh, login)
|   NavVis SDK      |                                             |
|   (ivion.js)      |                                    +-------------------+
+-------------------+                                    | building_settings |
         |                                               | (token cache)     |
         | 4. api.auth.updateToken() every ~10 min       +-------------------+
         v
+-------------------+
|   Full API access |
|   moveToImageId() |
|   getMainView()   |
+-------------------+
```

## Implementation Steps

### Step 1: Add `get-login-token` action to `ivion-poi` edge function

Add a new action that returns a valid Ivion JWT for the frontend SDK to use. This reuses the existing `getIvionToken()` from `ivion-auth.ts`.

**File: `supabase/functions/ivion-poi/index.ts`**

New action `get-login-token`:
- Accepts `buildingFmGuid` parameter
- Calls `getIvionToken(buildingFmGuid)` to get a valid access token
- Returns `{ success: true, loginToken, expiresInMs }` so the frontend knows when to refresh
- The token is already managed (cached, refreshed, or obtained via login) by `ivion-auth.ts`

### Step 2: Update SDK initialization to pass `loginToken`

**File: `src/lib/ivion-sdk.ts`**

Update `loadIvionSdk()` signature to accept an optional `loginToken`:
- `loadIvionSdk(baseUrl, timeoutMs, loginToken?)` 
- Pass `{ loginToken }` as second argument to `getApi(baseUrl, { loginToken })`
- Update the `IvionApi` interface to include `auth` property with `updateToken()` and `getToken()` methods

### Step 3: Fetch token and pass to SDK in Ivion360View

**File: `src/components/viewer/Ivion360View.tsx`**

Before attempting SDK load:
1. Call `ivion-poi` with `action: 'get-login-token'` to get a JWT
2. Pass the token to `loadIvionSdk(baseUrl, timeout, loginToken)`
3. Set up a periodic refresh (every 10 minutes) using `api.auth.updateToken(newToken)` to keep the session alive
4. On refresh failure, log a warning but don't crash (the SDK may still work with the current token for a while)

### Step 4: Add token refresh loop

**File: `src/components/viewer/Ivion360View.tsx`**

Add a `useEffect` that:
- Runs when `sdkStatus === 'ready'` and `ivApiRef.current` exists
- Sets up an interval (every 10 minutes)
- Fetches a fresh token via `ivion-poi` `get-login-token`
- Calls `ivApiRef.current.auth.updateToken(newToken)` to refresh
- Cleans up interval on unmount

### Step 5: Update IvionApi type definitions

**File: `src/lib/ivion-sdk.ts`**

Add auth-related interfaces:
```text
interface IvionAuthApi {
  getToken(): string;
  updateToken(token: string, uploadToken?: string): void;
  loginWithToken(token: string, awaitDataLoad?: boolean): Promise<any>;
  currentUser: any;
}

interface IvionApi {
  // ... existing methods ...
  auth?: IvionAuthApi;
}
```

## CORS Consideration

The SDK script (`ivion.js`) must still be loadable from the Ivion instance. If the Ivion instance doesn't serve CORS headers for our domain, the script won't load regardless of authentication.

**Two paths forward:**
1. **Preferred**: Ask the Ivion admin to add our domain to their CORS allowlist. This is a one-time configuration change on the Ivion server.
2. **Fallback**: If CORS can't be configured, the iframe approach remains the only option. With `loginToken`, we can still improve the iframe experience by appending the token as a URL parameter (if supported by the Ivion instance).

The current fetch-probe already handles this gracefully -- if `ivion.js` is unreachable, it falls back to iframe mode immediately.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/ivion-poi/index.ts` | Add `get-login-token` action that returns a valid JWT for frontend SDK use |
| `src/lib/ivion-sdk.ts` | Add `IvionAuthApi` interface, update `loadIvionSdk` to accept `loginToken`, pass to `getApi()` config |
| `src/components/viewer/Ivion360View.tsx` | Fetch loginToken before SDK init, set up periodic token refresh via `api.auth.updateToken()` |

## Token Flow Summary

1. **Initial load**: Frontend calls `get-login-token` -> edge function uses `ivion-auth.ts` -> returns cached/refreshed/new JWT
2. **SDK init**: `getApi(baseUrl, { loginToken: jwt })` -> SDK authenticates automatically, no manual login needed
3. **Token refresh**: Every 10 min, frontend fetches new token -> calls `api.auth.updateToken(newJwt)` -> SDK continues working
4. **Failure handling**: If token fetch fails, SDK loads without token (user sees Ivion login page in the viewer). If SDK load fails entirely (CORS), falls back to iframe.

## Technical Notes

- The `loginToken` config option removes the logout button from the Ivion UI, which is desirable in an embedded context
- `updateToken()` must be called before the current token expires (tokens last ~15 min, refresh at 10 min is safe)
- The same token works for both local accounts and OAuth Resource Server setups
- No new secrets or database changes needed -- all infrastructure already exists

