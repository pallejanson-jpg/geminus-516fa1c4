
# 3-legged OAuth for Autodesk Construction Cloud

## Problem

All ACC data APIs (Locations, Assets, Categories, Projects) return 403 Forbidden because the APS application has not been added as a "Custom Integration" in the ACC Account Admin. This is a requirement for 2-legged (app-only) OAuth.

The manual project ID workaround only bypasses project listing -- the actual sync calls to Locations API and Assets API still fail with 403 for the same reason.

## Solution: 3-legged OAuth (User Login)

With 3-legged OAuth, the user logs in with their own Autodesk account and grants the app permission to access their data. The API calls then run with the user's own permissions, bypassing the Custom Integration requirement entirely.

### How it works

```text
User Flow:

1. User clicks "Logga in med Autodesk" in ACC settings
         |
         v
2. Browser opens Autodesk login page (popup or redirect)
         |
         v
3. User logs in and grants permission
         |
         v
4. Autodesk redirects back to app with authorization code
         |
         v
5. Edge function exchanges code for access + refresh tokens
         |
         v
6. Tokens stored securely in database (encrypted)
         |
         v
7. All ACC API calls now use the user's token
         |
         v
8. Automatic token refresh when expired
```

## Changes Required

### 1. New Edge Function: `acc-auth` (token exchange and refresh)

A new edge function to handle the OAuth callback:

- **`exchange-code` action**: Receives the authorization code from the frontend, exchanges it with Autodesk for access and refresh tokens, stores them in a new `acc_tokens` table
- **`refresh-token` action**: Uses the stored refresh token to get a new access token when the current one expires
- **`check-auth` action**: Returns whether the user has a valid Autodesk session
- **`logout` action**: Deletes stored tokens

### 2. New Database Table: `acc_oauth_tokens`

Stores the user's Autodesk tokens securely:

- `id` (uuid, primary key)
- `user_id` (uuid, references auth user)
- `access_token` (text, encrypted)
- `refresh_token` (text, encrypted)
- `expires_at` (timestamptz)
- `created_at` / `updated_at` (timestamptz)
- RLS: Users can only see/manage their own tokens

### 3. Update Edge Function: `acc-sync/index.ts`

Modify the existing function to support both authentication methods:

- New helper `getAccTokenForUser(userId)` that:
  - Checks `acc_oauth_tokens` for a valid 3-legged token
  - If expired, automatically refreshes it
  - Falls back to 2-legged `getApsAccessToken()` if no user token exists
- All API calls (`fetchAllLocationNodes`, `fetchAccAssets`, etc.) use whichever token is available
- The `list-projects` action benefits the most -- 3-legged tokens typically have direct access to the user's projects

### 4. Update UI: `ApiSettingsModal.tsx` (ACC tab)

Add Autodesk login flow to the ACC settings:

- "Logga in med Autodesk" button that opens the Autodesk authorization URL in a popup
- Listen for the callback with the authorization code
- Show login status (logged in as / not logged in)
- "Logga ut" button to clear stored tokens
- Once logged in, "Hamta projekt" and sync buttons work as before but use the user's own permissions

### 5. App Configuration

The APS application in Autodesk Developer Portal needs a **Callback URL** configured. This will be the app's URL (e.g., `https://[project].lovable.app/auth/autodesk/callback`).

A simple callback page is needed to capture the authorization code and send it back to the parent window.

## File Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/acc-auth/index.ts` | New edge function for token exchange/refresh |
| `supabase/functions/acc-sync/index.ts` | Add 3-legged token support alongside 2-legged |
| `src/components/settings/ApiSettingsModal.tsx` | Add "Logga in med Autodesk" button and status |
| `src/pages/AutodeskCallback.tsx` | New callback page to capture authorization code |
| `src/App.tsx` | Add route for `/auth/autodesk/callback` |
| `supabase/config.toml` | Register new `acc-auth` function with `verify_jwt = false` |
| Database migration | Create `acc_oauth_tokens` table with RLS |

## Important Notes

- The **APS_CLIENT_ID** and **APS_CLIENT_SECRET** secrets are already configured and will be reused
- A **Callback URL** must be added in the Autodesk Developer Portal (APS app settings) -- this is a one-time manual step
- 3-legged tokens expire after 1 hour but can be refreshed using the refresh token (valid for 15 days)
- Both 2-legged and 3-legged methods will coexist -- if 3-legged is available it takes priority, otherwise falls back to 2-legged
