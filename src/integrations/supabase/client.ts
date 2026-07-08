import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Pinned to our own Supabase project ("Geminus", lzhlfditqujumnmfqqvq).
// Do NOT read these from import.meta.env: Lovable's GitHub bot regenerates .env
// on every sync and points VITE_SUPABASE_* back at its own project. The key
// is public by design, so hardcoding keeps every build (local, Lovable, CI)
// talking to the same backend.
// NOTE: legacy JWT anon keys were disabled by Supabase's platform migration
// (July 2026) — only the sb_publishable_* key format works now.
export const SUPABASE_URL = 'https://lzhlfditqujumnmfqqvq.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kajozGqcD_h2r2GKWKziEA_op_F_D7f';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
