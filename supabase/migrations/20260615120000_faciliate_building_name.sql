-- Add building_name to the Faciliate cache so work orders/contracts can be
-- filtered by building (the connector populates it on the next sync).
ALTER TABLE public.faciliate_records ADD COLUMN IF NOT EXISTS building_name text;
CREATE INDEX IF NOT EXISTS idx_faciliate_records_building_name ON public.faciliate_records (building_name);
