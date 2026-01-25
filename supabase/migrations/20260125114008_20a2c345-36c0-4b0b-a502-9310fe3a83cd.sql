-- Add coordinate fields for 3D position and local creation tracking to assets table
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS coordinate_x numeric NULL,
ADD COLUMN IF NOT EXISTS coordinate_y numeric NULL,
ADD COLUMN IF NOT EXISTS coordinate_z numeric NULL,
ADD COLUMN IF NOT EXISTS is_local boolean NOT NULL DEFAULT false;

-- Add index for filtering local (not yet synced) assets
CREATE INDEX IF NOT EXISTS idx_assets_is_local ON public.assets(is_local) WHERE is_local = true;

-- Add comment for documentation
COMMENT ON COLUMN public.assets.coordinate_x IS 'X coordinate for 3D placement (from annotation picker)';
COMMENT ON COLUMN public.assets.coordinate_y IS 'Y coordinate for 3D placement (from annotation picker)';
COMMENT ON COLUMN public.assets.coordinate_z IS 'Z coordinate for 3D placement (from annotation picker)';
COMMENT ON COLUMN public.assets.is_local IS 'True if asset was created locally and not yet synced to Asset+';