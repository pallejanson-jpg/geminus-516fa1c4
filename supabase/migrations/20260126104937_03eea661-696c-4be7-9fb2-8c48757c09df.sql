-- Add symbol_id column to assets for per-asset symbol assignment
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS symbol_id UUID REFERENCES public.annotation_symbols(id) ON DELETE SET NULL;

-- Create index for efficient symbol lookups
CREATE INDEX IF NOT EXISTS idx_assets_symbol_id ON public.assets(symbol_id);

-- Enable insert and update on assets for service role operations
CREATE POLICY "Service role can insert assets"
ON public.assets
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service role can update assets"  
ON public.assets
FOR UPDATE
USING (true);

-- Create storage bucket for symbol icons
INSERT INTO storage.buckets (id, name, public) 
VALUES ('symbol-icons', 'symbol-icons', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for symbol icons - public read
CREATE POLICY "Public read access to symbol icons"
ON storage.objects
FOR SELECT
USING (bucket_id = 'symbol-icons');

-- Anyone can upload symbol icons
CREATE POLICY "Anyone can upload symbol icons"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'symbol-icons');

-- Anyone can update symbol icons
CREATE POLICY "Anyone can update symbol icons"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'symbol-icons');

-- Anyone can delete symbol icons
CREATE POLICY "Anyone can delete symbol icons"
ON storage.objects
FOR DELETE
USING (bucket_id = 'symbol-icons');