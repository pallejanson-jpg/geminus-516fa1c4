-- Allow public read access to assets since auth is removed
DROP POLICY IF EXISTS "Authenticated users can read assets" ON public.assets;

CREATE POLICY "Public read access to assets"
ON public.assets FOR SELECT
TO public
USING (true);

-- Allow public read access to asset_sync_state
DROP POLICY IF EXISTS "Admins can read sync state" ON public.asset_sync_state;

CREATE POLICY "Public read access to sync state"
ON public.asset_sync_state FOR SELECT
TO public
USING (true);

-- Allow public read access to asset_sync_progress
DROP POLICY IF EXISTS "Admins can read sync progress" ON public.asset_sync_progress;

CREATE POLICY "Public read access to sync progress"
ON public.asset_sync_progress FOR SELECT
TO public
USING (true);