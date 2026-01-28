-- Add latitude/longitude columns to building_settings for map positioning
ALTER TABLE public.building_settings 
ADD COLUMN IF NOT EXISTS latitude numeric,
ADD COLUMN IF NOT EXISTS longitude numeric;

-- Create storage bucket for inventory images
INSERT INTO storage.buckets (id, name, public)
VALUES ('inventory-images', 'inventory-images', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for inventory images
CREATE POLICY "Anyone can view inventory images" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'inventory-images');

CREATE POLICY "Anyone can upload inventory images" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'inventory-images');

CREATE POLICY "Anyone can update inventory images" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'inventory-images');

CREATE POLICY "Anyone can delete inventory images" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'inventory-images');