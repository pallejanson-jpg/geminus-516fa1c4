import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export interface AuthResult {
  authenticated: boolean;
  userId: string | null;
  isAdmin: boolean;
  error?: string;
  supabase?: SupabaseClient;
}

/**
 * Verify authentication for an edge function request.
 * Returns user info and a client scoped to the user.
 */
export async function verifyAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  
  if (!authHeader?.startsWith("Bearer ")) {
    return { authenticated: false, userId: null, isAdmin: false, error: "Missing or invalid Authorization header" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Use getUser for reliable user validation (works with all signing methods)
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { authenticated: false, userId: null, isAdmin: false, error: error?.message || "Invalid token" };
  }

  const userId = user.id;

  // Check admin role using service role client
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, serviceKey);
  
  const { data: roleData } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  const isAdmin = roleData?.role === "admin";

  return {
    authenticated: true,
    userId,
    isAdmin,
    supabase,
  };
}

/**
 * Create a 401 Unauthorized response
 */
export function unauthorizedResponse(message = "Unauthorized"): Response {
  return new Response(
    JSON.stringify({ error: message, success: false }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Create a 403 Forbidden response (for admin-only endpoints)
 */
export function forbiddenResponse(message = "Admin access required"): Response {
  return new Response(
    JSON.stringify({ error: message, success: false }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
