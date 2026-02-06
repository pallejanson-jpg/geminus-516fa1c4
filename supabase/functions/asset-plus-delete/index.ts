import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

/**
 * asset-plus-delete: Delete/Expire assets from Asset+ and/or local database.
 *
 * - Local-only assets (is_local=true): deleted directly from local DB
 * - Synced assets (is_local=false): expired in Asset+ via ExpireObject, then deleted locally
 * - BIM-created objects (created_in_model=true) are protected by default unless force=true
 */

// Get Keycloak access token
async function getAccessToken(): Promise<string> {
  const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
  const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
  const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
  const username = Deno.env.get("ASSET_PLUS_USERNAME");
  const password = Deno.env.get("ASSET_PLUS_PASSWORD");

  if (!keycloakUrl || !clientId) {
    throw new Error("Missing Keycloak configuration");
  }

  const tokenUrl = keycloakUrl.endsWith("/protocol/openid-connect/token")
    ? keycloakUrl
    : `${keycloakUrl.replace(/\/+$/, "")}/protocol/openid-connect/token`;

  if (username && password) {
    const params = new URLSearchParams({
      grant_type: "password",
      username,
      password,
      client_id: clientId,
    });
    if (clientSecret) params.set("client_secret", clientSecret);

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (res.ok) {
      const data = await res.json();
      return data.access_token;
    }
  }

  throw new Error("Keycloak auth failed");
}

interface DeleteRequest {
  fmGuids: string[];
  expireDate?: string; // ISO date string, defaults to now
  force?: boolean; // Allow deleting BIM-created objects
}

interface DeleteResult {
  fmGuid: string;
  success: boolean;
  error?: string;
  wasLocal: boolean;
  expired?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body: DeleteRequest = await req.json();

    if (!body.fmGuids || !Array.isArray(body.fmGuids) || body.fmGuids.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "fmGuids array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit batch size
    if (body.fmGuids.length > 50) {
      return new Response(
        JSON.stringify({ success: false, error: "Maximum 50 items per request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch all assets to determine local vs synced
    const { data: assets, error: fetchError } = await supabase
      .from("assets")
      .select("fm_guid, is_local, created_in_model, category")
      .in("fm_guid", body.fmGuids);

    if (fetchError) {
      return new Response(
        JSON.stringify({ success: false, error: `DB fetch error: ${fetchError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const assetMap = new Map((assets || []).map(a => [a.fm_guid, a]));
    const results: DeleteResult[] = [];

    // Separate into local and synced
    const localFmGuids: string[] = [];
    const syncedFmGuids: string[] = [];

    for (const fmGuid of body.fmGuids) {
      const asset = assetMap.get(fmGuid);
      
      if (!asset) {
        results.push({ fmGuid, success: false, error: "Asset not found", wasLocal: false });
        continue;
      }

      // Protect BIM-created objects unless force=true
      if (asset.created_in_model && !body.force) {
        results.push({
          fmGuid,
          success: false,
          error: "BIM-created object cannot be deleted (use force=true to override)",
          wasLocal: asset.is_local,
        });
        continue;
      }

      if (asset.is_local) {
        localFmGuids.push(fmGuid);
      } else {
        syncedFmGuids.push(fmGuid);
      }
    }

    // 2. Delete local-only assets directly from DB
    if (localFmGuids.length > 0) {
      const { error: deleteError } = await supabase
        .from("assets")
        .delete()
        .in("fm_guid", localFmGuids);

      for (const fmGuid of localFmGuids) {
        if (deleteError) {
          results.push({ fmGuid, success: false, error: deleteError.message, wasLocal: true });
        } else {
          results.push({ fmGuid, success: true, wasLocal: true });
        }
      }
    }

    // 3. Expire synced assets in Asset+ then delete locally
    if (syncedFmGuids.length > 0) {
      const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";

      if (!apiUrl) {
        for (const fmGuid of syncedFmGuids) {
          results.push({ fmGuid, success: false, error: "Asset+ API URL not configured", wasLocal: false });
        }
      } else {
        try {
          const accessToken = await getAccessToken();
          const baseUrl = apiUrl.replace(/\/+$/, "");
          const expireDate = body.expireDate || new Date().toISOString();

          // Build ExpireObject request
          const expirePayload = {
            apiKey,
            expireBimObjects: syncedFmGuids.map(fmGuid => ({
              fmGuid,
              expireDate,
            })),
          };

          const endpoint = `${baseUrl}/ExpireObject`;
          console.log(`Expiring ${syncedFmGuids.length} objects in Asset+: ${endpoint}`);

          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify(expirePayload),
          });

          const responseText = await response.text();
          console.log(`Asset+ ExpireObject response: ${response.status} - ${responseText || "(empty)"}`);

          if (response.ok) {
            // Asset+ expire succeeded - now delete from local DB using service role
            const { error: deleteError } = await supabase
              .from("assets")
              .delete()
              .in("fm_guid", syncedFmGuids);

            for (const fmGuid of syncedFmGuids) {
              if (deleteError) {
                results.push({
                  fmGuid,
                  success: true,
                  expired: true,
                  wasLocal: false,
                  error: `Expired in Asset+ but local delete failed: ${deleteError.message}`,
                });
              } else {
                results.push({ fmGuid, success: true, expired: true, wasLocal: false });
              }
            }
          } else {
            // Try to parse error response
            let errorMsg = `Asset+ ExpireObject failed: ${response.status}`;
            try {
              if (responseText) {
                const errorData = JSON.parse(responseText);
                if (Array.isArray(errorData)) {
                  errorMsg = errorData.map((e: any) => e.errorMessage || e.message || JSON.stringify(e)).join(", ");
                } else if (errorData.message) {
                  errorMsg = errorData.message;
                }
              }
            } catch {
              errorMsg = responseText || errorMsg;
            }

            for (const fmGuid of syncedFmGuids) {
              results.push({ fmGuid, success: false, error: errorMsg, wasLocal: false });
            }
          }
        } catch (authError) {
          const errMsg = authError instanceof Error ? authError.message : "Auth failed";
          for (const fmGuid of syncedFmGuids) {
            results.push({ fmGuid, success: false, error: errMsg, wasLocal: false });
          }
        }
      }
    }

    const summary = {
      total: body.fmGuids.length,
      deleted: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      localDeleted: results.filter(r => r.success && r.wasLocal).length,
      expiredInAssetPlus: results.filter(r => r.success && r.expired).length,
    };

    return new Response(
      JSON.stringify({ success: summary.failed === 0, results, summary }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("asset-plus-delete error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
