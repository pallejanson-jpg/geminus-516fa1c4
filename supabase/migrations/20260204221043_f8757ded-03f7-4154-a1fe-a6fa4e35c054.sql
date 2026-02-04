-- Add columns for Ivion start view coordinates (yaw/pitch angles in radians)
ALTER TABLE public.building_settings 
ADD COLUMN IF NOT EXISTS ivion_start_vlon NUMERIC,
ADD COLUMN IF NOT EXISTS ivion_start_vlat NUMERIC;

-- Set start position for Akerselva building
UPDATE public.building_settings 
SET ivion_start_vlon = -1.38, ivion_start_vlat = -0.25
WHERE fm_guid = '9baa7a3a-717d-4fcb-8718-0f5ca618b28a';

-- Add comment to explain the columns
COMMENT ON COLUMN public.building_settings.ivion_start_vlon IS 'Ivion start view yaw angle in radians (-π to π)';
COMMENT ON COLUMN public.building_settings.ivion_start_vlat IS 'Ivion start view pitch angle in radians (-π/2 to π/2)';