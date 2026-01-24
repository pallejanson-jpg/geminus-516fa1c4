-- Create building_settings table for storing per-building configurations
CREATE TABLE public.building_settings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    fm_guid TEXT NOT NULL UNIQUE,
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    ivion_site_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.building_settings ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (similar to assets table)
CREATE POLICY "Public read access to building settings" 
ON public.building_settings 
FOR SELECT 
USING (true);

-- Create policy for public insert (no auth for now)
CREATE POLICY "Public insert access to building settings" 
ON public.building_settings 
FOR INSERT 
WITH CHECK (true);

-- Create policy for public update
CREATE POLICY "Public update access to building settings" 
ON public.building_settings 
FOR UPDATE 
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_building_settings_fm_guid ON public.building_settings(fm_guid);
CREATE INDEX idx_building_settings_favorites ON public.building_settings(is_favorite) WHERE is_favorite = true;

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_building_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_building_settings_updated_at
BEFORE UPDATE ON public.building_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_building_settings_updated_at();