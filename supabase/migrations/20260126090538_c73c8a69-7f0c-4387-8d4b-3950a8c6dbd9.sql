-- Create annotation_symbols table for configurable symbol properties
CREATE TABLE public.annotation_symbols (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    icon_url TEXT,
    marker_html TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.annotation_symbols ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read access to annotation symbols"
ON public.annotation_symbols FOR SELECT USING (true);

-- Public insert access
CREATE POLICY "Public insert access to annotation symbols"
ON public.annotation_symbols FOR INSERT WITH CHECK (true);

-- Public update access
CREATE POLICY "Public update access to annotation symbols"
ON public.annotation_symbols FOR UPDATE USING (true);

-- Public delete access
CREATE POLICY "Public delete access to annotation symbols"
ON public.annotation_symbols FOR DELETE USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_annotation_symbols_updated_at
BEFORE UPDATE ON public.annotation_symbols
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add columns to assets table for annotation tracking
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS created_in_model BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS annotation_placed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS annotation_model_id TEXT;

-- Insert default symbols
INSERT INTO public.annotation_symbols (name, category, color, is_default)
VALUES 
  ('Brandsymboler', 'Fire', '#EF4444', false),
  ('Sensorer', 'Sensor', '#F59E0B', false),
  ('Sprinkler', 'Sprinkler', '#3B82F6', false),
  ('Standard', 'Default', '#6B7280', true);