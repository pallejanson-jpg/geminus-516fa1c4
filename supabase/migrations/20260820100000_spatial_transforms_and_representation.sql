-- Phase 2 of the viewer coordinator work (see docs/plans/viewer-coordinator-spec-and-prompts.md,
-- "Del C.3"): adds explicit spatial-origin classification to assets, and a versioned
-- xeokit<->NavVis calibration table that replaces the single offset+rotation columns
-- on building_settings.
--
-- annotation_placed is intentionally NOT touched here — it stays in place as a
-- deprecated-but-present column until a later, separate migration drops it, per the
-- plan's explicit "keep the column during the migration" note.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS spatial_representation text
    CHECK (spatial_representation IN
      ('bim-object', 'spatial-point', 'space-centroid', 'navvis-location', 'unlocated'))
    DEFAULT 'unlocated',
  ADD COLUMN IF NOT EXISTS location_accuracy text
    CHECK (location_accuracy IN
      ('surveyed', 'model-derived', 'navvis-derived', 'space-derived', 'manually-placed'))
    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS transform_version integer DEFAULT NULL;

COMMENT ON COLUMN public.assets.spatial_representation IS
  'Where this asset''s position comes from: bim-object (has a geometry_entity_map row), '
  'spatial-point (manually/AI-placed coordinate), space-centroid (approximated at its '
  'room''s centroid), navvis-location (Ivion POI only, no BIM coordinate), unlocated '
  '(no position yet — appears in the Unplaced Assets panel).';
COMMENT ON COLUMN public.assets.location_accuracy IS
  'How much to trust the position: surveyed, model-derived, navvis-derived, space-derived, '
  'manually-placed. Independent of spatial_representation — e.g. a manually-placed point can '
  'still later be confirmed as surveyed.';
COMMENT ON COLUMN public.assets.transform_version IS
  'Which spatial_transforms.version (for this asset''s building) was in effect when this '
  'coordinate was computed or placed.';

CREATE TABLE IF NOT EXISTS public.spatial_transforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_fm_guid text NOT NULL,
  source_system text NOT NULL DEFAULT 'navvis',
  target_system text NOT NULL DEFAULT 'xeokit',
  matrix4x4 numeric[16] NOT NULL,
  navvis_site_id text,
  version integer NOT NULL,
  residual_error_mm numeric,
  calibration_points jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_fm_guid, version)
);

CREATE INDEX IF NOT EXISTS idx_spatial_transforms_building ON public.spatial_transforms (building_fm_guid);

COMMENT ON TABLE public.spatial_transforms IS
  'Versioned xeokit<->NavVis calibration per building. Row-major 4x4 affine matrix; never '
  'overwrite an existing version — a new calibration always inserts version = max(version)+1. '
  'Replaces building_settings.ivion_bim_offset_x/y/z + ivion_bim_rotation (migrated to version 1 below).';

ALTER TABLE public.spatial_transforms ENABLE ROW LEVEL SECURITY;

-- Matches the RLS shape already established for geometry_entity_map (a peer
-- geometry/calibration table with the same building_fm_guid-scoped shape,
-- see 20260324172502_e712c352-974d-4632-86e2-409ad5ac60df.sql): readable by any
-- authenticated user, writable by service role (the annotations Edge Function) or admins.
CREATE POLICY "Authenticated users can read spatial_transforms"
  ON public.spatial_transforms FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage spatial_transforms"
  ON public.spatial_transforms FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Admins can manage spatial_transforms"
  ON public.spatial_transforms FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── Data migration: building_settings offset+rotation -> spatial_transforms version 1 ──
-- Equivalent 4x4 affine matrix for "rotate (x,z) around Y by `rotation` degrees, then
-- translate by (offset_x, offset_y, offset_z)" — the exact transform
-- src/lib/ivion-bim-transform.ts's ivionToBim() computes, and what
-- src/viewer/SpatialReferenceService.ts's buildOffsetRotationTransform() also builds
-- (see its unit tests for the equivalence proof).
INSERT INTO public.spatial_transforms
  (building_fm_guid, source_system, target_system, matrix4x4, navvis_site_id, version)
SELECT
  bs.fm_guid,
  'navvis',
  'xeokit',
  ARRAY[
    cos(radians(coalesce(bs.ivion_bim_rotation, 0))), 0, -sin(radians(coalesce(bs.ivion_bim_rotation, 0))), coalesce(bs.ivion_bim_offset_x, 0),
    0, 1, 0, coalesce(bs.ivion_bim_offset_y, 0),
    sin(radians(coalesce(bs.ivion_bim_rotation, 0))), 0, cos(radians(coalesce(bs.ivion_bim_rotation, 0))), coalesce(bs.ivion_bim_offset_z, 0),
    0, 0, 0, 1
  ]::numeric[16],
  bs.ivion_site_id,
  1
FROM public.building_settings bs
WHERE bs.fm_guid IS NOT NULL
ON CONFLICT (building_fm_guid, version) DO NOTHING;

-- Backfill transform_version = 1 on assets that already have a position sourced through
-- that transform (a BIM coordinate or an Ivion POI link) — matches the plan's explicit
-- backfill instruction ("assets that already have coordinate_x/y/z or ivion_poi_id set").
UPDATE public.assets
SET transform_version = 1
WHERE transform_version IS NULL
  AND (coordinate_x IS NOT NULL OR coordinate_y IS NOT NULL OR coordinate_z IS NOT NULL OR ivion_poi_id IS NOT NULL);

-- Backfill spatial_representation for existing assets using the priority order from Del C.3:
-- 1. geometry_entity_map row -> bim-object
-- 2. manual/AI coordinate -> spatial-point
-- 3. ivion_poi_id only, no BIM coordinate -> navvis-location
-- 4. in_room_fm_guid but no coordinate -> space-centroid
-- 5. otherwise -> unlocated (the column default, so no action needed)
UPDATE public.assets a
SET spatial_representation = 'bim-object'
WHERE EXISTS (
  SELECT 1 FROM public.geometry_entity_map gem WHERE gem.asset_fm_guid = a.fm_guid
);

UPDATE public.assets a
SET spatial_representation = 'spatial-point'
WHERE spatial_representation = 'unlocated'
  AND (a.coordinate_x IS NOT NULL OR a.coordinate_y IS NOT NULL OR a.coordinate_z IS NOT NULL);

UPDATE public.assets a
SET spatial_representation = 'navvis-location'
WHERE spatial_representation = 'unlocated'
  AND a.ivion_poi_id IS NOT NULL;

UPDATE public.assets a
SET spatial_representation = 'space-centroid'
WHERE spatial_representation = 'unlocated'
  AND a.in_room_fm_guid IS NOT NULL;
