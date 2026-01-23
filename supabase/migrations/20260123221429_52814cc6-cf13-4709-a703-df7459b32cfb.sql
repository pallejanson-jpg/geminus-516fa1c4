-- Allow public read access to assets for Navigator functionality
-- This enables the tree view to work without requiring authentication
DROP POLICY IF EXISTS "Authenticated users can read assets" ON public.assets;

CREATE POLICY "Public read access to assets"
  ON public.assets
  FOR SELECT
  USING (true);

-- Also update asset_sync_state to be publicly readable for sync status UI
DROP POLICY IF EXISTS "Authenticated users can read sync state" ON public.asset_sync_state;

CREATE POLICY "Public read access to sync state"
  ON public.asset_sync_state
  FOR SELECT
  USING (true);