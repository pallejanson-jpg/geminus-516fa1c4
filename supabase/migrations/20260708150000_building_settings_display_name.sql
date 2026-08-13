-- Add display_name to building_settings so buildings without asset rows
-- can have a human-readable name shown in portfolio/navigator.
ALTER TABLE public.building_settings
  ADD COLUMN IF NOT EXISTS display_name TEXT;
