-- geminus_plus_endpoint_cache stores the Autodesk APS app's Client ID/Secret.
-- Two existing policies let it be read/written directly from the browser:
--   - "Admins can read endpoint cache" (FOR SELECT USING is_admin()) — lets an
--     admin's client read the plaintext Client Secret straight into page state.
--   - "Authenticated users can manage endpoint cache" (FOR ALL, added 20260624) —
--     lets ANY logged-in user read AND write it, not just admins.
--
-- The frontend no longer touches this table directly: reading/writing the APS
-- credentials now goes through the acc-auth edge function's admin-gated
-- get-aps-config-status / set-aps-credentials actions (using the service role),
-- which never sends the secret back to the client at all. Drop both client-facing
-- policies — "Service role can manage endpoint cache" (TO service_role, from
-- 20260516072244) already covers every legitimate remaining access path.

DROP POLICY IF EXISTS "Authenticated users can manage endpoint cache" ON public.geminus_plus_endpoint_cache;
DROP POLICY IF EXISTS "Admins can read endpoint cache" ON public.geminus_plus_endpoint_cache;
