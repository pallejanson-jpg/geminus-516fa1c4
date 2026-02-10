
-- GUID mapping table between ACC fm_guids and Asset+ UUIDs
CREATE TABLE public.acc_assetplus_guid_map (
  acc_fm_guid TEXT PRIMARY KEY,
  assetplus_fm_guid UUID NOT NULL DEFAULT gen_random_uuid(),
  object_type INTEGER NOT NULL DEFAULT 4,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.acc_assetplus_guid_map ENABLE ROW LEVEL SECURITY;

-- Only service role and admins can manage this table
CREATE POLICY "Admins can read guid map" ON public.acc_assetplus_guid_map
  FOR SELECT USING (is_admin());

CREATE POLICY "Service role can manage guid map" ON public.acc_assetplus_guid_map
  FOR ALL USING (true) WITH CHECK (true);
