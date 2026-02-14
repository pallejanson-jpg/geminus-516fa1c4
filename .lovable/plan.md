

## Fix: HDC postMessage token field name

### Problem
The HDC client receives our `HDC_CONFIG` message and starts making API calls, but all calls return **401 Unauthorized**. This means the token is not being picked up correctly by the HDC client's internal HTTP layer.

### Root Cause (Most Likely)
The postMessage payload uses `token` as the field name, but the HDC client likely expects `accessToken` (the standard OAuth2 field name). The HDC client code would look for `event.data.accessToken` internally.

### Solution
Update `FmAccess2DPanel.tsx` to send the config with `accessToken` instead of `token`, and also include the `apiUrl` field which the HDC client may need to know which backend to authenticate against.

### Changes

**File: `src/components/viewer/FmAccess2DPanel.tsx`**

Update the postMessage config payload (around line 130):

```text
// BEFORE:
{
  type: 'HDC_CONFIG',
  token: embedConfig.token,
  versionId: ...,
  objectId: ...
}

// AFTER - try accessToken field name:
{
  type: 'HDC_CONFIG',
  accessToken: embedConfig.token,
  token: embedConfig.token,        // keep both for compatibility
  versionId: ...,
  objectId: ...
}
```

This sends both `accessToken` and `token` so whichever field name the HDC client uses will work. No edge function changes needed -- the 401s confirm the backend token itself is valid (since it works in the edge function's own API calls).

### Why this should work
- The HDC client IS processing our config (it starts loading drawings)
- The token works fine when the edge function uses it directly
- The only gap is how the HDC client picks up the token from the postMessage payload
- OAuth2 convention uses `accessToken` or `access_token` as the field name

