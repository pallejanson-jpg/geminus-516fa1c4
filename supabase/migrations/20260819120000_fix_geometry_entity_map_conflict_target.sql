-- Fix geometry_entity_map upsert conflict target.
--
-- The original unique index (idx_gem_unique, from 20260324172502) is expression-based:
--   (source_system, building_fm_guid, asset_fm_guid, COALESCE(model_id, ''))
-- PostgREST's `on_conflict` request parameter can only reference plain column names, not
-- SQL expressions, so geminus-plus-sync's batch upsert (which passes the literal string
-- "source_system,building_fm_guid,asset_fm_guid,COALESCE(model_id, '')" as on_conflict)
-- always fails with a 400 from PostgREST, falls back to per-row upserts with no
-- on_conflict target at all (defaulting to the primary key `id`, which is always fresh),
-- and every insert result is discarded unchecked — so entities that already have a
-- mapping row silently fail to insert (blocked by idx_gem_unique) and their
-- last_seen_at/model_id/storey_fm_guid are never refreshed by later syncs.
--
-- Fix: add a real, stored column that mirrors the same COALESCE expression, and back it
-- with a plain-column unique index that PostgREST's on_conflict can target correctly.
-- The old expression index is dropped since the new index enforces the identical
-- constraint. The application code (geminus-plus-sync/index.ts, upsertGeometryMappings)
-- is updated in the same change to target the new column list.

-- Defensive: remove any rows that would violate the new plain-column unique index.
-- (None are expected — the existing idx_gem_unique already enforces this constraint at
-- the database level today — but this keeps the migration safe to re-run/idempotent if
-- that assumption is ever wrong.) Keeps the most recently seen row per group.
DELETE FROM public.geometry_entity_map a
USING public.geometry_entity_map b
WHERE a.source_system = b.source_system
  AND a.building_fm_guid = b.building_fm_guid
  AND a.asset_fm_guid = b.asset_fm_guid
  AND COALESCE(a.model_id, '') = COALESCE(b.model_id, '')
  AND (
    a.last_seen_at < b.last_seen_at
    OR (a.last_seen_at = b.last_seen_at AND a.id < b.id)
  );

ALTER TABLE public.geometry_entity_map
  ADD COLUMN IF NOT EXISTS model_id_norm TEXT GENERATED ALWAYS AS (COALESCE(model_id, '')) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gem_unique_norm
  ON public.geometry_entity_map (source_system, building_fm_guid, asset_fm_guid, model_id_norm);

DROP INDEX IF EXISTS public.idx_gem_unique;
