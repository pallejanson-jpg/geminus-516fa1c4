-- ============================================================
-- Fix RLS policies so the local Node.js / browser app can
-- read and write the XKT model cache without a logged-in user.
--
-- Run this in: Lovable → SQL Editor  (or Supabase Dashboard → SQL Editor)
-- ============================================================

-- ── 1. xkt_models table ──────────────────────────────────────
-- The existing policies were tightened to TO authenticated in a later migration.
-- Re-open them to the anon role so the browser can:
--   • check the cache (SELECT)
--   • store newly-fetched models (INSERT, UPDATE)

DROP POLICY IF EXISTS "Authenticated users can read xkt models"  ON public.xkt_models;
DROP POLICY IF EXISTS "Authenticated users can insert xkt models" ON public.xkt_models;
DROP POLICY IF EXISTS "Authenticated users can update xkt models" ON public.xkt_models;
DROP POLICY IF EXISTS "Public read access to xkt_models"         ON public.xkt_models;
DROP POLICY IF EXISTS "Service role can insert xkt_models"       ON public.xkt_models;
DROP POLICY IF EXISTS "Service role can update xkt_models"       ON public.xkt_models;

CREATE POLICY "Public read xkt_models"
ON public.xkt_models FOR SELECT TO public USING (true);

CREATE POLICY "Public insert xkt_models"
ON public.xkt_models FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Public update xkt_models"
ON public.xkt_models FOR UPDATE TO public USING (true) WITH CHECK (true);


-- ── 2. xkt-models storage bucket ─────────────────────────────
-- The bucket was created with public=false and upload policies restricted
-- to authenticated users. Open uploads to the anon role so the browser's
-- Cache-on-Load strategy can write XKT files after fetching them from Asset+.

DROP POLICY IF EXISTS "Authenticated users can read XKT models"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload XKT models" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update XKT models" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read of XKT models"           ON storage.objects;

CREATE POLICY "Public read xkt-models bucket"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'xkt-models');

CREATE POLICY "Public upload xkt-models bucket"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id = 'xkt-models');

CREATE POLICY "Public update xkt-models bucket"
ON storage.objects FOR UPDATE TO public
USING (bucket_id = 'xkt-models')
WITH CHECK (bucket_id = 'xkt-models');
