-- Create storage bucket for cached GLB models (for Cesium 3D globe)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('glb-models', 'glb-models', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to read GLB models
CREATE POLICY "Authenticated users can read glb models"
ON storage.objects FOR SELECT
USING (bucket_id = 'glb-models' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to upload GLB models
CREATE POLICY "Authenticated users can upload glb models"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'glb-models' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to update GLB models (upsert)
CREATE POLICY "Authenticated users can update glb models"
ON storage.objects FOR UPDATE
USING (bucket_id = 'glb-models' AND auth.uid() IS NOT NULL);