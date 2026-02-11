
# Fix: Gunnar Chat 401 Authentication Error

## Root Cause

Every Gunnar question fails with **401 Unauthorized** because of two issues working together:

1. **Frontend sends the wrong token** -- `GunnarChat.tsx` line 122 sends the anon key (`VITE_SUPABASE_PUBLISHABLE_KEY`) as the Authorization header instead of the logged-in user's session token. The anon key has no `sub` claim, so authentication always fails.

2. **Missing config.toml entry** -- The `gunnar-chat` function is not listed in `supabase/config.toml` with `verify_jwt = false`. This means Supabase's gateway rejects the request before the function code even runs (since the anon key is not a valid user JWT).

## Fix

### 1. `supabase/config.toml` -- Add gunnar-chat entry

Add `verify_jwt = false` so the edge runtime does not block requests before the function handles auth internally via `verifyAuth()`.

### 2. `src/components/chat/GunnarChat.tsx` -- Use the user's session token

Replace the static anon key with the actual user session token from the Supabase client:

```text
Before:  Authorization: Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}
After:   Authorization: Bearer <session.access_token from supabase.auth.getSession()>
```

Import the supabase client and fetch the session before making the API call. If no session exists, show a toast error instead of making the request.

## Files Changed

| File | Change |
|---|---|
| `supabase/config.toml` | Add `[functions.gunnar-chat]` with `verify_jwt = false` |
| `src/components/chat/GunnarChat.tsx` | Import supabase client, get session token, use it in Authorization header |
