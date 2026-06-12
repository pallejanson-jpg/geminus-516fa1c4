import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Pinned to our own Supabase project ("Geminus", lzhlfditqujumnmfqqvq).
// Do NOT read these from import.meta.env: Lovable's GitHub bot regenerates .env
// on every sync and points VITE_SUPABASE_* back at its own project. The anon key
// is public by design, so hardcoding keeps every build (local, Lovable, CI)
// talking to the same backend.
export const SUPABASE_URL = 'https://lzhlfditqujumnmfqqvq.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6aGxmZGl0cXVqdW1ubWZxcXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDgwNjksImV4cCI6MjA5NjgyNDA2OX0.Kh-JDtaW46KMy5m85i17mVlH5nih-uBOOUqhQ0hcJzM';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
