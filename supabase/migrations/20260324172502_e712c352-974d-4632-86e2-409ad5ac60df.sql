
CREATE TABLE public.geometry_entity_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid TEXT NOT NULL,
  asset_fm_guid TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'asset_plus',
  external_entity_id TEXT,
  entity_type TEXT NOT NULL DEFAULT 'instance',
  model_id TEXT,
  storey_fm_guid TEXT,
  source_model_guid TEXT,
  source_model_name TEXT,
  source_storey_name TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE UNIQUE INDEX idx_gem_unique ON public.geometry_entity_map (source_system, building_fm_guid, asset_fm_guid, COALESCE(model_id, ''));
CREATE INDEX idx_gem_building ON public.geometry_entity_map (building_fm_guid);
CREATE INDEX idx_gem_asset ON public.geometry_entity_map (asset_fm_guid);
CREATE INDEX idx_gem_external ON public.geometry_entity_map (external_entity_id) WHERE external_entity_id IS NOT NULL;
CREATE INDEX idx_gem_model ON public.geometry_entity_map (model_id) WHERE model_id IS NOT NULL;
CREATE INDEX idx_gem_storey ON public.geometry_entity_map (storey_fm_guid) WHERE storey_fm_guid IS NOT NULL;

ALTER TABLE public.geometry_entity_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read geometry_entity_map"
  ON public.geometry_entity_map FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage geometry_entity_map"
  ON public.geometry_entity_map FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins can manage geometry_entity_map"
  ON public.geometry_entity_map FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
