
-- IoT sensor RPC functions for Geminus AI

CREATE OR REPLACE FUNCTION public.get_sensors_in_room(sensor_type text, room_guid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  type_pattern text;
BEGIN
  type_pattern := '%' || sensor_type || '%';
  SELECT jsonb_agg(row_to_json(t)::jsonb)
  INTO result
  FROM (
    SELECT a.fm_guid, a.name, a.common_name, a.category, a.asset_type,
           a.building_fm_guid, a.level_fm_guid, a.in_room_fm_guid,
           a.attributes
    FROM assets a
    WHERE a.in_room_fm_guid = room_guid
      AND (
        a.asset_type ILIKE type_pattern
        OR a.category IN ('IfcSensor', 'IfcAlarm')
        OR a.asset_type IN ('IfcSensor', 'IfcAlarm')
      )
    LIMIT 200
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_sensor_values(sensor_ids text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(t)::jsonb)
  INTO result
  FROM (
    SELECT
      a.fm_guid,
      a.asset_type AS sensor_type,
      a.in_room_fm_guid AS room_fm_guid,
      a.common_name AS room_name,
      a.attributes->>'temperature' AS temperature,
      a.attributes->>'co2' AS co2,
      a.attributes->>'humidity' AS humidity,
      a.attributes->>'value' AS value,
      a.attributes->>'unit' AS unit,
      a.attributes->>'status' AS status,
      a.attributes->>'last_reading_at' AS last_reading_at
    FROM assets a
    WHERE a.fm_guid = ANY(sensor_ids)
    LIMIT 200
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
