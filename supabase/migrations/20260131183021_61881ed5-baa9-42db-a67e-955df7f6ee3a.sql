-- Add example_images column to detection_templates for few-shot learning
ALTER TABLE detection_templates 
ADD COLUMN example_images TEXT[] DEFAULT '{}';

-- Create storage bucket for template example images
INSERT INTO storage.buckets (id, name, public) 
VALUES ('template-examples', 'template-examples', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to template examples
CREATE POLICY "Template examples are publicly accessible" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'template-examples');

-- Allow authenticated users to upload template examples
CREATE POLICY "Authenticated users can upload template examples" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'template-examples' AND auth.role() = 'authenticated');

-- Allow authenticated users to delete template examples
CREATE POLICY "Authenticated users can delete template examples" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'template-examples' AND auth.role() = 'authenticated');

-- Comment for documentation
COMMENT ON COLUMN detection_templates.example_images IS 'Array of URLs to example images for few-shot learning in AI detection';