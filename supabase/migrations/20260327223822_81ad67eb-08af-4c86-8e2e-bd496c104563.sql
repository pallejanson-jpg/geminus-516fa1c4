
-- 1. get_assets_by_system: query assets by system/asset_type
CREATE OR REPLACE FUNCTION public.get_assets_by_system(system_query text, building_guid text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(t)::jsonb)
  INTO result
  FROM (
    SELECT fm_guid, name, common_name, category, asset_type,
           building_fm_guid, level_fm_guid, in_room_fm_guid
    FROM assets
    WHERE asset_type ILIKE '%' || system_query || '%'
      AND (building_guid IS NULL OR building_fm_guid = building_guid)
    LIMIT 200
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 2. get_assets_in_room: all assets in a specific room
CREATE OR REPLACE FUNCTION public.get_assets_in_room(room_guid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(t)::jsonb)
  INTO result
  FROM (
    SELECT fm_guid, name, common_name, category, asset_type,
           building_fm_guid, level_fm_guid, in_room_fm_guid
    FROM assets
    WHERE in_room_fm_guid = room_guid
    LIMIT 200
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 3. get_assets_by_category: assets filtered by category
CREATE OR REPLACE FUNCTION public.get_assets_by_category(cat text, building_guid text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(t)::jsonb)
  INTO result
  FROM (
    SELECT fm_guid, name, common_name, category, asset_type,
           building_fm_guid, level_fm_guid, in_room_fm_guid
    FROM assets
    WHERE category ILIKE '%' || cat || '%'
      AND (building_guid IS NULL OR building_fm_guid = building_guid)
    LIMIT 200
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 4. search_assets_rpc: free-text search on name/common_name/asset_type
CREATE OR REPLACE FUNCTION public.search_assets_rpc(search text, building_guid text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    LIMIT 200
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 5. get_viewer_entities: given asset fm_guids, return external_entity_ids
CREATE OR REPLACE FUNCTION public.get_viewer_entities(asset_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(t)::jsonb)
  INTO result
  FROM (
    SELECT asset_fm_guid, external_entity_id, model_id, storey_fm_guid
    FROM geometry_entity_map
    WHERE asset_fm_guid = ANY(asset_ids)
      AND external_entity_id IS NOT NULL
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
