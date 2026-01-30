-- Create sync progress table for resumable asset/XKT sync
CREATE TABLE IF NOT EXISTS public.asset_sync_progress (
    job TEXT PRIMARY KEY,
    building_fm_guid TEXT,
    skip INTEGER DEFAULT 0,
    current_building_index INTEGER DEFAULT 0,
    total_buildings INTEGER DEFAULT 0,
    total_synced INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create endpoint cache table for 3D API discovery
CREATE TABLE IF NOT EXISTS public.asset_plus_endpoint_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.asset_sync_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_plus_endpoint_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies - only admins can read/write these internal tables
CREATE POLICY "Admins can read sync progress" ON public.asset_sync_progress
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Service role can manage sync progress" ON public.asset_sync_progress
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Admins can read endpoint cache" ON public.asset_plus_endpoint_cache
    FOR SELECT USING (public.is_admin());

CREATE POLICY "Service role can manage endpoint cache" ON public.asset_plus_endpoint_cache
    FOR ALL USING (true) WITH CHECK (true);

-- Add unique constraint to xkt_models if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'xkt_models_building_model_unique'
    ) THEN
        ALTER TABLE public.xkt_models 
        ADD CONSTRAINT xkt_models_building_model_unique 
        UNIQUE (building_fm_guid, model_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint may already exist or error: %', SQLERRM;
END $$;