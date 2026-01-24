-- Create storage bucket for XKT model caching
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'xkt-models', 
  'xkt-models', 
  false, 
  104857600,  -- 100MB max file size for XKT models
  ARRAY['application/octet-stream', 'model/gltf-binary', 'application/json']
);

-- RLS: Allow reading XKT models (authenticated or anon)
CREATE POLICY "Allow public read of XKT models"
ON storage.objects FOR SELECT
USING (bucket_id = 'xkt-models');

-- RLS: Allow service role to insert/update XKT models (via edge function)
-- Note: Edge functions use service_role key which bypasses RLS