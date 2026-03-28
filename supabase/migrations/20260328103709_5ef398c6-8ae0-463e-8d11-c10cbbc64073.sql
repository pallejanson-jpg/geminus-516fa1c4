
CREATE OR REPLACE FUNCTION public.get_room_sensor_data(
  p_building_guid text,
  p_floor_guid text DEFAULT NULL,
  p_metric text DEFAULT 'temperature',
  p_sort_order text DEFAULT 'desc'
)
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
      a.common_name,
      a.name,
      a.level_fm_guid,
      -- Extract sensor values from JSONB attributes (keys have hash suffixes, values are {value: N} objects)
      (SELECT (v.value::jsonb->>'value')::numeric
       FROM jsonb_each_text(a.attributes) AS v(key, value)
       WHERE v.key ILIKE 'sensortemperature%'
       LIMIT 1) AS temperature,
      (SELECT (v.value::jsonb->>'value')::numeric
       FROM jsonb_each_text(a.attributes) AS v(key, value)
       WHERE v.key ILIKE 'sensorco2%'
       LIMIT 1) AS co2,
      (SELECT (v.value::jsonb->>'value')::numeric
       FROM jsonb_each_text(a.attributes) AS v(key, value)
       WHERE v.key ILIKE 'sensorhum%'
       LIMIT 1) AS humidity,
      (SELECT (v.value::jsonb->>'value')::numeric
       FROM jsonb_each_text(a.attributes) AS v(key, value)
       WHERE v.key ILIKE 'sensoroccupancy%'
       LIMIT 1) AS occupancy
    FROM assets a
    WHERE a.category = 'Space'
      AND a.building_fm_guid = p_building_guid
      AND (p_floor_guid IS NULL OR a.level_fm_guid = p_floor_guid)
    ORDER BY
      CASE
        WHEN p_metric = 'temperature' AND p_sort_order = 'desc' THEN
          -(SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensortemperature%' LIMIT 1)
        WHEN p_metric = 'temperature' AND p_sort_order = 'asc' THEN
          (SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensortemperature%' LIMIT 1)
        WHEN p_metric = 'co2' AND p_sort_order = 'desc' THEN
          -(SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensorco2%' LIMIT 1)
        WHEN p_metric = 'co2' AND p_sort_order = 'asc' THEN
          (SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensorco2%' LIMIT 1)
        WHEN p_metric = 'humidity' AND p_sort_order = 'desc' THEN
          -(SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensorhum%' LIMIT 1)
        WHEN p_metric = 'humidity' AND p_sort_order = 'asc' THEN
          (SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensorhum%' LIMIT 1)
        WHEN p_metric = 'occupancy' AND p_sort_order = 'desc' THEN
          -(SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensoroccupancy%' LIMIT 1)
        WHEN p_metric = 'occupancy' AND p_sort_order = 'asc' THEN
          (SELECT (v.value::jsonb->>'value')::numeric
            FROM jsonb_each_text(a.attributes) AS v(key, value)
            WHERE v.key ILIKE 'sensoroccupancy%' LIMIT 1)
        ELSE 0
      END NULLS LAST
    LIMIT 200
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
