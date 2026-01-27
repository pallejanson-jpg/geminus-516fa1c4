-- Create xkt_models table to track synced XKT model files
CREATE TABLE public.xkt_models (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    building_fm_guid TEXT NOT NULL,
    building_name TEXT,
    model_id TEXT NOT NULL,
    model_name TEXT,
    file_name TEXT NOT NULL,
    file_url TEXT,
    file_size BIGINT,
    storage_path TEXT NOT NULL,
    source_url TEXT,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(building_fm_guid, model_id)
);

-- Enable Row Level Security
ALTER TABLE public.xkt_models ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (like assets table)
CREATE POLICY "Public read access to xkt_models"
ON public.xkt_models
FOR SELECT
USING (true);

-- Create policy for service role insert
CREATE POLICY "Service role can insert xkt_models"
ON public.xkt_models
FOR INSERT
WITH CHECK (true);

-- Create policy for service role update
CREATE POLICY "Service role can update xkt_models"
ON public.xkt_models
FOR UPDATE
USING (true);

-- Create indexes for fast lookups
CREATE INDEX idx_xkt_models_building ON public.xkt_models(building_fm_guid);
CREATE INDEX idx_xkt_models_model_id ON public.xkt_models(model_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_xkt_models_updated_at
BEFORE UPDATE ON public.xkt_models
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();