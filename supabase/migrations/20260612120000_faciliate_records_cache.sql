-- Cache table for Faciliate data synced by the local VPN connector.
-- Generic by design: exact field names per object type are confirmed once the
-- RestAPI server is reachable, so we keep the full record in `raw` and extract
-- a few common columns for fast filtering.

CREATE TABLE IF NOT EXISTS public.faciliate_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type text NOT NULL,            -- 'workorder' | 'rentlandlord' | 'maintenance' | ...
  source_guid text NOT NULL,            -- guid from Faciliate
  title text,
  status text,
  building_id text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_type, source_guid)
);

CREATE INDEX IF NOT EXISTS idx_faciliate_records_type ON public.faciliate_records (object_type);
CREATE INDEX IF NOT EXISTS idx_faciliate_records_building ON public.faciliate_records (building_id);
CREATE INDEX IF NOT EXISTS idx_faciliate_records_status ON public.faciliate_records (status);

ALTER TABLE public.faciliate_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read faciliate_records"
  ON public.faciliate_records FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage faciliate_records"
  ON public.faciliate_records FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
