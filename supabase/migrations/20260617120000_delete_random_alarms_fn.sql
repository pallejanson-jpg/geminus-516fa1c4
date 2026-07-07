-- RPC to delete a random percentage of IfcAlarm assets for a building.
-- Uses SECURITY DEFINER to bypass RLS (avoids client-side IN-list URL limits).
CREATE OR REPLACE FUNCTION delete_random_alarms(
  p_building_fm_guid text,
  p_keep_fraction float DEFAULT 0.1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH to_delete AS (
    SELECT id
    FROM public.assets
    WHERE building_fm_guid = p_building_fm_guid
      AND asset_type = 'IfcAlarm'
      AND random() > p_keep_fraction
  )
  DELETE FROM public.assets
  WHERE id IN (SELECT id FROM to_delete);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
