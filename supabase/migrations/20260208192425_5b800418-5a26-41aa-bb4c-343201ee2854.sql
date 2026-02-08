
-- Add Ivion-to-BIM alignment columns to building_settings
ALTER TABLE public.building_settings
  ADD COLUMN IF NOT EXISTS ivion_bim_offset_x numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ivion_bim_offset_y numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ivion_bim_offset_z numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ivion_bim_rotation numeric DEFAULT 0;
