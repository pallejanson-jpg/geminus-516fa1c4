

## Fix support-proxy: JWT-based authentication

From the request headers you provided, the SWG portal authentication is now clear:

1. **Login endpoint**: POST to `/api/users/login` with `{ email, password }` -- this returns a JWT token
2. **Auth header**: Subsequent requests use a **`jwt`** header (not `Cookie`, `realm`, or `Expression`)
3. The JWT contains user/company data and has ~10 hour TTL (`exp` - `iat`)

### Changes

**`supabase/functions/support-proxy/index.ts`** -- Complete rewrite of auth logic:

1. Replace the multi-endpoint discovery `login()` with a single POST to `/api/users/login` sending `{ email, password }` (using `SWG_SUPPORT_USERNAME` as email)
2. Cache the returned JWT token (not cookies/realm/expression)
3. In `proxyRequest()`, send the JWT as a `jwt` header on all API calls
4. Remove `tryEndpoint()` and `discover-endpoints` action (no longer needed)
5. Keep `test-login`, `list-requests`, `get-request`, `create-request`, `add-comment` actions
6. Fix build error (the current code compiles fine, so the build error is likely elsewhere -- will check)

### Build error
The build error says "dev server state is error" but doesn't give specifics. The edge function code itself doesn't affect the Vite build. Need to check if there's a frontend import issue.

