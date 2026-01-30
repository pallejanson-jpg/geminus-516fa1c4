-- Add hero image URL column to building_settings
ALTER TABLE public.building_settings 
ADD COLUMN IF NOT EXISTS hero_image_url TEXT DEFAULT NULL;