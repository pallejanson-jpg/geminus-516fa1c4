-- Add Ivion-related columns to assets table for POI synchronization
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS ivion_poi_id INTEGER;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS ivion_site_id TEXT;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS ivion_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS ivion_image_id INTEGER;

-- Add index for efficient lookups by Ivion POI ID
CREATE INDEX IF NOT EXISTS idx_assets_ivion_poi_id ON public.assets(ivion_poi_id) WHERE ivion_poi_id IS NOT NULL;

-- Add index for lookups by Ivion site
CREATE INDEX IF NOT EXISTS idx_assets_ivion_site_id ON public.assets(ivion_site_id) WHERE ivion_site_id IS NOT NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN public.assets.ivion_poi_id IS 'Ivion Point of Interest ID for deep-linking';
COMMENT ON COLUMN public.assets.ivion_site_id IS 'Ivion site ID this asset belongs to';
COMMENT ON COLUMN public.assets.ivion_synced_at IS 'Last synchronization timestamp with Ivion';
COMMENT ON COLUMN public.assets.ivion_image_id IS 'Ivion panorama image ID for position reference';