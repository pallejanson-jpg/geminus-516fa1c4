import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

/**
 * Property data types for Geminus Plus API
 * 0 = String
 * 1 = Int32
 * 2 = Int64
 * 3 = Decimal
 * 4 = DateTime
 * 5 = Bool
 */
const DataType = {
  String: 0,
  Int32: 1,
  Int64: 2,
  Decimal: 3,
  DateTime: 4,
  Bool: 5,
} as const;

// Get Keycloak access token
async function getAccessToken(): Promise<string> {
  const keycloakUrl = Deno.env.get("GEMINUS_PLUS_KEYCLOAK_URL");
  const clientId = Deno.env.get("GEMINUS_PLUS_CLIENT_ID");
  const clientSecret = Deno.env.get("GEMINUS_PLUS_CLIENT_SECRET");
  const username = Deno.env.get("GEMINUS_PLUS_USERNAME");
  const password = Deno.env.get("GEMINUS_PLUS_PASSWORD");

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

    if (clientSecret) {
      params.set("client_secret", clientSecret);
    }

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

interface UpdateProperty {
  name: string;      // "commonName", "designation", or user parameter name
  value: string | number | boolean;
  dataType?: number; // Default: 0 (String)
}

interface UpdateAssetRequest {
  fmGuids: string[];     // Array of FM GUIDs to update
  properties: UpdateProperty[];
}

interface UpdateResult {
  fmGuid: string;
  success: boolean;
  error?: string;
  synced?: boolean; // Whether synced to Geminus Plus
}

/**
 * Map frontend property keys to Geminus Plus API parameter names
 */
function mapPropertyToGeminusPlus(key: string): { name: string; isSystem: boolean } | null {
  const systemMapping: Record<string, string> = {
    'common_name': 'commonName',
    'commonName': 'commonName',
    'name': 'designation',
    'designation': 'designation',
  };

  if (systemMapping[key]) {
    return { name: systemMapping[key], isSystem: true };
  }

  // User parameters are passed through as-is
  return { name: key, isSystem: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify authentication
  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body: UpdateAssetRequest = await req.json();
    
    // Validate required fields
    if (!body.fmGuids || body.fmGuids.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "fmGuids array is required" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (!body.properties || body.properties.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "properties array is required" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch assets to determine is_local status
    const { data: assets, error: fetchError } = await supabase
      .from("assets")
      .select("fm_guid, is_local")
      .in("fm_guid", body.fmGuids);

    if (fetchError) {
      console.error("Failed to fetch assets:", fetchError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch assets from database" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group assets by is_local status
    const localAssets = assets?.filter(a => a.is_local === true) || [];
    const syncedAssets = assets?.filter(a => a.is_local === false) || [];
    
    const results: UpdateResult[] = [];

    // Build local database update payload
    const dbPayload: Record<string, any> = {};
    for (const prop of body.properties) {
      // Map property name for database
      let dbKey = prop.name;
      if (prop.name === 'commonName') dbKey = 'common_name';
      if (prop.name === 'designation') dbKey = 'name';
      
      dbPayload[dbKey] = prop.value;
    }

    // Update local database for ALL assets (both local and synced)
    if (Object.keys(dbPayload).length > 0) {
      const { error: updateError } = await supabase
        .from("assets")
        .update(dbPayload)
        .in("fm_guid", body.fmGuids);

      if (updateError) {
        console.error("Failed to update local database:", updateError);
        // Don't fail completely - continue with Geminus Plus sync if applicable
      }
    }

    // For synced assets, also update Geminus Plus API
    if (syncedAssets.length > 0) {
      try {
        const accessToken = await getAccessToken();
        const apiUrl = Deno.env.get("GEMINUS_PLUS_API_URL") || "";
        const apiKey = Deno.env.get("GEMINUS_PLUS_API_KEY") || "";

        if (!apiUrl) {
          throw new Error("Geminus Plus API URL not configured");
        }

        const baseUrl = apiUrl.replace(/\/+$/, "");
        const endpoint = `${baseUrl}/UpdateBimObjectsPropertiesData`;

        // Build UpdateBimObjectProperties array for each synced asset
        const updatePayload = {
          APIKey: apiKey,
          UpdateBimObjectProperties: syncedAssets.map(asset => ({
            FmGuid: asset.fm_guid,
            UpdateProperties: body.properties.map(prop => {
              const mapped = mapPropertyToGeminusPlus(prop.name);
              return {
                Name: mapped?.name || prop.name,
                Type: prop.dataType ?? DataType.String,
                Value: String(prop.value),
              };
            }),
          })),
        };

        console.log(`Updating ${syncedAssets.length} assets in Geminus Plus API: ${endpoint}`);
        console.log("Payload:", JSON.stringify(updatePayload, null, 2));

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify(updatePayload),
        });

        const responseText = await response.text();
        console.log(`Geminus Plus API response: ${response.status} - ${responseText || "(empty)"}`);

        if (!response.ok) {
          let errorMessage = `Geminus Plus API error: ${response.status}`;
          try {
            if (responseText) {
              const errorData = JSON.parse(responseText);
              if (Array.isArray(errorData)) {
                errorMessage = errorData.map((e: any) => e.errorMessage || e.message || JSON.stringify(e)).join(", ");
              } else if (errorData.message) {
                errorMessage = errorData.message;
              }
            }
          } catch {
            errorMessage = responseText || errorMessage;
          }

          // Mark synced assets as failed
          for (const asset of syncedAssets) {
            results.push({
              fmGuid: asset.fm_guid,
              success: false,
              error: errorMessage,
              synced: false,
            });
          }
        } else {
          // Mark synced assets as successful
          for (const asset of syncedAssets) {
            results.push({
              fmGuid: asset.fm_guid,
              success: true,
              synced: true,
            });
          }
        }
      } catch (syncError) {
        console.error("Geminus Plus sync error:", syncError);
        // Mark synced assets as failed
        for (const asset of syncedAssets) {
          results.push({
            fmGuid: asset.fm_guid,
            success: false,
            error: syncError instanceof Error ? syncError.message : "Geminus Plus sync failed",
            synced: false,
          });
        }
      }
    }

    // Mark local assets as successful (only local DB update needed)
    for (const asset of localAssets) {
      results.push({
        fmGuid: asset.fm_guid,
        success: true,
        synced: false,
      });
    }

    // Calculate summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    const syncedCount = results.filter(r => r.synced).length;

    return new Response(
      JSON.stringify({ 
        success: failedCount === 0,
        message: `Updated ${successCount} assets (${syncedCount} synced to Geminus Plus)`,
        results,
        summary: {
          total: body.fmGuids.length,
          success: successCount,
          failed: failedCount,
          syncedToGeminusPlus: syncedCount,
          localOnly: localAssets.length,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("geminus-plus-update error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Internal server error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
