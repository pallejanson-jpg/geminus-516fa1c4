/**
 * Shared Supabase Realtime subscription for annotation changes on `public.assets`,
 * scoped to one building. Used to replace poll-based annotation refresh so that a
 * change made in one viewer (or by another user/tab) shows up in the other without
 * requiring a specific panel to be open (Phase 2 item 7 of
 * docs/plans/viewer-coordinator-spec-and-prompts.md).
 *
 * NOT used for detecting brand-new POIs created directly in the NavVis Ivion UI —
 * those don't exist in `assets` yet (that's the whole point of importing them), so
 * they can't be observed via Postgres changes on this table. That's a different
 * mechanism (src/components/viewer/Ivion360View.tsx's `get-latest-poi` polling,
 * intentionally left as-is — see docs/viewer-current-state-verified.md).
 */

import { supabase } from '@/integrations/supabase/client';

/**
 * Subscribe to any insert/update/delete on `assets` for the given building.
 * `onChange` is called with no arguments — callers are expected to re-fetch/re-render
 * from scratch rather than try to diff the changed row, since a single change (e.g.
 * clearing symbol_id) can affect what should be shown well beyond that one row.
 */
export function subscribeToBuildingAnnotations(buildingFmGuid: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`building-annotations-${buildingFmGuid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'assets', filter: `building_fm_guid=eq.${buildingFmGuid}` },
      () => onChange(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
