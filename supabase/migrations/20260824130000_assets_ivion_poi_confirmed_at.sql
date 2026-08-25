-- Tracks whether an auto-placed Ivion 360° POI position has been reviewed
-- and confirmed by a user (vs. just staged near a cluster anchor point).
--
-- ivion_poi_id IS NULL                                    -> no POI created yet
-- ivion_poi_id IS NOT NULL AND ivion_poi_confirmed_at NULL -> staged, needs review
-- ivion_poi_confirmed_at IS NOT NULL                      -> position confirmed
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS ivion_poi_confirmed_at timestamptz;
