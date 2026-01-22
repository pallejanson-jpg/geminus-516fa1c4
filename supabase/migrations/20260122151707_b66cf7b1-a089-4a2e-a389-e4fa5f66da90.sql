-- Core asset index table (~50k rows, optimized for hierarchy queries)
CREATE TABLE public.assets (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    fm_guid TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    name TEXT,
    common_name TEXT,
    
    -- Hierarchy relations (nullable for top-level buildings)
    building_fm_guid TEXT,
    level_fm_guid TEXT,
    in_room_fm_guid TEXT,
    complex_common_name TEXT,
    
    -- Frequently queried attributes (denormalized for speed)
    gross_area NUMERIC,
    asset_type TEXT,
    
    -- Extended attributes as JSON (for less common queries)
    attributes JSONB DEFAULT '{}',
    
    -- Sync metadata
    source_updated_at TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for fast hierarchy and category queries
CREATE INDEX idx_assets_category ON public.assets(category);
CREATE INDEX idx_assets_building ON public.assets(building_fm_guid);
CREATE INDEX idx_assets_level ON public.assets(level_fm_guid);
CREATE INDEX idx_assets_in_room ON public.assets(in_room_fm_guid);
CREATE INDEX idx_assets_category_building ON public.assets(category, building_fm_guid);
CREATE INDEX idx_assets_name_search ON public.assets USING gin(to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(common_name, '')));

-- Sync state tracking per subtree/building
CREATE TABLE public.asset_sync_state (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    subtree_id TEXT NOT NULL UNIQUE,
    subtree_name TEXT,
    last_sync_started_at TIMESTAMP WITH TIME ZONE,
    last_sync_completed_at TIMESTAMP WITH TIME ZONE,
    total_assets INTEGER DEFAULT 0,
    sync_status TEXT DEFAULT 'pending', -- pending, running, completed, failed
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_sync_state ENABLE ROW LEVEL SECURITY;

-- Assets are readable by all authenticated users (write via backend only)
CREATE POLICY "Authenticated users can read assets"
ON public.assets
FOR SELECT
USING (auth.role() = 'authenticated');

-- Sync state readable by authenticated users
CREATE POLICY "Authenticated users can read sync state"
ON public.asset_sync_state
FOR SELECT
USING (auth.role() = 'authenticated');

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_assets_updated_at
BEFORE UPDATE ON public.assets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_asset_sync_state_updated_at
BEFORE UPDATE ON public.asset_sync_state
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();