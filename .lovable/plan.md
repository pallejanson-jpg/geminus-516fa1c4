

## Fix: Switch from postMessage to URL-parameter authentication

### Problem
The HDC client uses an internal Keycloak adapter (`hdcAuth`) for authentication. The `postMessage` with `HDC_CONFIG` does not properly initialize this adapter, causing all internal API calls to fail with 401.

### Root Cause
The TslLogger source code reveals the HDC client relies on `hdcAuth.getToken()` and `hdcAuth.isAuthenticated()` -- a full Keycloak adapter. Our postMessage sends a raw token string, but the client needs its Keycloak adapter initialized. This is likely only possible by passing the full Keycloak config (realm URL, clientId, etc.) which we don't control.

### Solution
Switch from the `awaitConfig=true` postMessage approach to **URL-parameter authentication**, which already works in the `get-viewer-url` action. The HDC client's `/client/` endpoint accepts `token`, `versionId`, and `objectId` as URL parameters directly.

### Changes

**File: `src/components/viewer/FmAccess2DPanel.tsx`**

1. **Simplify the embed URL** to include token, versionId, and objectId as query parameters instead of using `awaitConfig=true`
2. **Remove the postMessage handshake** (HDC_APP_READY_FOR_CONFIG / HDC_CONFIG listeners) since auth is passed via URL
3. **Keep the HDC_APP_SYSTEM_READY listener** (or timeout) to know when to reveal the iframe
4. Update the edge function response to build the full URL with parameters

The embed URL will be constructed as:
```
{apiUrl}/client/?token={token}&versionId={versionId}&objectId={objectId}
```

This matches the pattern already used successfully in the `get-viewer-url` action (line 444 of the edge function).

### Technical Details

- Remove the `HDC_APP_READY_FOR_CONFIG` message handler
- Remove the `configSentRef` tracking
- Build the iframe src URL with query parameters directly
- Simplify the phase state machine: `fetching-config` -> `loading-iframe` -> `ready` (skip `waiting-ready` and `sending-config`)
- Keep the timeout fallback for revealing the iframe
- The iframe `onLoad` event can directly transition to `ready` phase

### Why this should work
- The `get-viewer-url` action already builds this exact URL pattern and it works
- URL parameters bypass the Keycloak adapter initialization issue entirely
- The HDC client's `/client/` endpoint is designed to accept auth via URL params
