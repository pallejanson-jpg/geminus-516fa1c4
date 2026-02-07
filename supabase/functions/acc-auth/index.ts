import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/auth.ts";

const APS_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";

function getClientCredentials() {
  const clientId = Deno.env.get("APS_CLIENT_ID");
  const clientSecret = Deno.env.get("APS_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Missing APS_CLIENT_ID or APS_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

function getServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey);
}

function getUserIdFromAuth(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

async function verifyUser(req: Request): Promise<{ userId: string; supabase: any }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing Authorization header");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error("Invalid token");
  }

  return { userId: user.id, supabase };
}

// Exchange authorization code for tokens
async function exchangeCode(code: string, redirectUri: string, userId: string) {
  const { clientId, clientSecret } = getClientCredentials();

  const res = await fetch(APS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Store tokens using service role (bypasses RLS)
  const serviceClient = getServiceClient();
  const { error } = await serviceClient
    .from("acc_oauth_tokens")
    .upsert(
      {
        user_id: userId,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) throw new Error(`Failed to store tokens: ${error.message}`);

  return { success: true, expires_at: expiresAt };
}

// Refresh an expired access token
async function refreshToken(userId: string) {
  const serviceClient = getServiceClient();

  const { data: tokenRow, error: fetchError } = await serviceClient
    .from("acc_oauth_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError || !tokenRow) {
    throw new Error("No stored tokens found for user");
  }

  const { clientId, clientSecret } = getClientCredentials();

  const res = await fetch(APS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    // If refresh fails, delete stored tokens (user needs to re-login)
    if (res.status === 400 || res.status === 401) {
      await serviceClient.from("acc_oauth_tokens").delete().eq("user_id", userId);
    }
    throw new Error(`Token refresh failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  const { error: updateError } = await serviceClient
    .from("acc_oauth_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateError) throw new Error(`Failed to update tokens: ${updateError.message}`);

  return { success: true, expires_at: expiresAt };
}

// Check if user has valid Autodesk auth
async function checkAuth(userId: string) {
  const serviceClient = getServiceClient();

  const { data: tokenRow } = await serviceClient
    .from("acc_oauth_tokens")
    .select("expires_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!tokenRow) {
    return { authenticated: false };
  }

  const isExpired = new Date(tokenRow.expires_at) < new Date();

  if (isExpired) {
    // Try to refresh automatically
    try {
      const refreshResult = await refreshToken(userId);
      return { authenticated: true, expires_at: refreshResult.expires_at };
    } catch {
      return { authenticated: false, reason: "refresh_failed" };
    }
  }

  return { authenticated: true, expires_at: tokenRow.expires_at };
}

// Delete stored tokens (logout)
async function logout(userId: string) {
  const serviceClient = getServiceClient();
  const { error } = await serviceClient
    .from("acc_oauth_tokens")
    .delete()
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to delete tokens: ${error.message}`);
  return { success: true };
}

// Get the authorization URL for Autodesk login
function getAuthUrl(redirectUri: string) {
  const { clientId } = getClientCredentials();
  const scope = "data:read account:read";
  const authUrl = `https://developer.api.autodesk.com/authentication/v2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
  return { authUrl };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // get-auth-url doesn't require user auth
    if (action === "get-auth-url") {
      const { redirectUri } = body;
      if (!redirectUri) throw new Error("redirectUri is required");
      const result = getAuthUrl(redirectUri);
      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All other actions require authenticated user
    const { userId } = await verifyUser(req);
    console.log(`ACC Auth action: ${action} (user: ${userId})`);

    let result: any;

    switch (action) {
      case "exchange-code": {
        const { code, redirectUri } = body;
        if (!code || !redirectUri) throw new Error("code and redirectUri are required");
        result = await exchangeCode(code, redirectUri, userId);
        break;
      }
      case "refresh-token": {
        result = await refreshToken(userId);
        break;
      }
      case "check-auth": {
        result = await checkAuth(userId);
        break;
      }
      case "logout": {
        result = await logout(userId);
        break;
      }
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ACC Auth error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
