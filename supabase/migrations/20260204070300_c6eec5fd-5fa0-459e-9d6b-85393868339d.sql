-- Add rotation column to building_settings for coordinate transformation
-- between 3D (BIM local) and 360° (geographic) coordinate systems

ALTER TABLE public.building_settings
ADD COLUMN IF NOT EXISTS rotation DECIMAL DEFAULT 0;

COMMENT ON COLUMN public.building_settings.rotation IS 'Building rotation in degrees relative to north (0-360). Used for synchronizing 3D and 360° viewer headings.';