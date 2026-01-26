-- Create work_orders table for Faciliate integration
CREATE TABLE public.work_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    guid TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT,
    category TEXT,
    building_fm_guid TEXT,
    building_name TEXT,
    space_fm_guid TEXT,
    space_name TEXT,
    reported_by TEXT,
    assigned_to TEXT,
    reported_at TIMESTAMP WITH TIME ZONE,
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    estimated_cost NUMERIC,
    actual_cost NUMERIC,
    attributes JSONB DEFAULT '{}'::jsonb,
    source_updated_at TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read access to work_orders"
ON public.work_orders
FOR SELECT
USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can insert work_orders"
ON public.work_orders
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service role can update work_orders"
ON public.work_orders
FOR UPDATE
USING (true);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_work_orders_updated_at
BEFORE UPDATE ON public.work_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for common queries
CREATE INDEX idx_work_orders_status ON public.work_orders(status);
CREATE INDEX idx_work_orders_building ON public.work_orders(building_fm_guid);
CREATE INDEX idx_work_orders_category ON public.work_orders(category);
CREATE INDEX idx_work_orders_due_date ON public.work_orders(due_date);

-- Create faciliate_sync_state table to track sync status
CREATE TABLE public.faciliate_sync_state (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sync_type TEXT NOT NULL DEFAULT 'work_orders',
    sync_status TEXT DEFAULT 'pending',
    total_items INTEGER DEFAULT 0,
    last_sync_started_at TIMESTAMP WITH TIME ZONE,
    last_sync_completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.faciliate_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to faciliate_sync_state"
ON public.faciliate_sync_state
FOR SELECT
USING (true);

CREATE TRIGGER update_faciliate_sync_state_updated_at
BEFORE UPDATE ON public.faciliate_sync_state
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();