
-- Enable pg_trgm for fast ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes on assets for fast ILIKE search
CREATE INDEX IF NOT EXISTS idx_assets_name_trgm ON public.assets USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_common_name_trgm ON public.assets USING gin (common_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_asset_type_trgm ON public.assets USING gin (asset_type gin_trgm_ops);

-- Btree index for building_fm_guid filtering (used in all scoped queries)
CREATE INDEX IF NOT EXISTS idx_assets_building_fm_guid ON public.assets (building_fm_guid);

-- Btree index for category filtering
CREATE INDEX IF NOT EXISTS idx_assets_category ON public.assets (category);

-- Btree index for in_room_fm_guid (used by get_assets_in_room)
CREATE INDEX IF NOT EXISTS idx_assets_in_room_fm_guid ON public.assets (in_room_fm_guid);

-- Index on geometry_entity_map for fast entity resolution
CREATE INDEX IF NOT EXISTS idx_gem_asset_fm_guid ON public.geometry_entity_map (asset_fm_guid);

-- Update search_assets_rpc to use lower limit for AI queries
CREATE OR REPLACE FUNCTION public.search_assets_rpc(search text, building_guid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  search_pattern text;
BEGIN
  search_pattern := '%' || search || '%';
  SELECT jsonb_agg(row_to_json(t)::jsonb)
  INTO result
  FROM (
    SELECT fm_guid, name, common_name, category, asset_type,
           building_fm_guid, level_fm_guid, in_room_fm_guid
    FROM assets
    WHERE (common_name ILIKE search_pattern
           OR name ILIKE search_pattern
           OR asset_type ILIKE search_pattern)
      AND (building_guid IS NULL OR building_fm_guid = building_guid)
    LIMIT 50
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;
