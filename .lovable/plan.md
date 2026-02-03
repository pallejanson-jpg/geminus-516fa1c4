

# Plan: Simplify Ivion Connection to Direct Token Input

## Problem
The current OAuth mandate flow fails with "Full authentication is required" because the NavVis `/api/auth/mandate/request` endpoint itself requires authentication - creating a catch-22 situation.

## Solution
Replace the complex mandate flow with a simple **direct token input** modal where users can paste their existing access token (like the one you already have).

## Changes

### 1. Redesign IvionConnectionModal.tsx

Replace the OAuth popup flow with a simple form:

```text
┌─────────────────────────────────────────────┐
│      Connect to NavVis IVION                │
├─────────────────────────────────────────────┤
│                                             │
│  Paste your NavVis access token below.      │
│  You can get this from the NavVis admin     │
│  panel or use an existing JWT token.        │
│                                             │
│  Access Token:                              │
│  ┌─────────────────────────────────────┐    │
│  │ eyJhbGciOiJIUzI1NiJ9...             │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Refresh Token (optional):                  │
│  ┌─────────────────────────────────────┐    │
│  │ (for automatic renewal)             │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │   Test Connection                    │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Status: Ready                              │
│                                             │
│  ┌─────────┐  ┌──────────────────────┐      │
│  │ Cancel  │  │  Save to Secrets     │      │
│  └─────────┘  └──────────────────────┘      │
└─────────────────────────────────────────────┘
```

**New Features:**
- Text input for Access Token
- Optional text input for Refresh Token
- "Test Connection" button that validates the token against Ivion API
- Token expiry detection with warning
- "Save to Secrets" button that opens Cloud secrets panel

### 2. Add Token Validation Action to Edge Function

Add a new `validate-token` action to `ivion-poi/index.ts`:

```typescript
case 'validate-token':
  // Validate a user-provided token by making a test API call
  if (!params.access_token) throw new Error('access_token required');
  try {
    // Try to list sites or make a simple API call
    const testResponse = await fetch(`${IVION_API_URL}/api/sites`, {
      headers: {
        'x-authorization': `Bearer ${params.access_token}`,
        'Accept': 'application/json',
      },
    });
    
    if (testResponse.ok) {
      const sites = await testResponse.json();
      result = {
        success: true,
        message: `Token valid! Found ${sites.length} sites.`,
        siteCount: sites.length,
      };
    } else {
      result = {
        success: false,
        error: `Token invalid: ${testResponse.status}`,
      };
    }
  } catch (e) {
    result = { success: false, error: e.message };
  }
  break;
```

### 3. Remove Complex Mandate Flow (Optional Cleanup)

The mandate-request, mandate-validate, and mandate-exchange actions can remain but won't be used by the simplified UI. They could be removed later for cleanup.

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/settings/IvionConnectionModal.tsx` | Rewrite | Replace OAuth popup flow with direct token input form |
| `supabase/functions/ivion-poi/index.ts` | Add | New `validate-token` action |

## User Flow After Changes

1. User clicks "Connect with NavVis OAuth" in Settings -> APIs
2. Modal opens with token input fields
3. User pastes their access token (like `eyJhbGciOiJIUzI1NiJ9...`)
4. User clicks "Test Connection" to verify it works
5. System shows "Token valid! Found X sites."
6. User is guided to save the token to Cloud secrets (IVION_ACCESS_TOKEN)
7. Connection complete!

## Benefits

1. **No authentication catch-22** - Works even when mandate endpoint requires auth
2. **Simple and fast** - No popups, no polling, no waiting
3. **Works with any valid token** - JWT from admin panel, API call, etc.
4. **Token validation** - Immediately confirms if the token works
5. **Expiry warning** - Shows when token will expire

## Token Expiry Handling

The modal will parse the JWT and show:
- "Valid for 25 minutes" (if not expired)
- "Token expired!" (if already expired)
- Reminder that IVION_REFRESH_TOKEN enables automatic renewal

