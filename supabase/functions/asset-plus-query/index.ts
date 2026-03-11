import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";
import { getAssetPlusCredentials } from "../_shared/credentials.ts";

// Get Keycloak access token for 3D Viewer
async function getAccessToken(creds: any): Promise<string> {
  const keycloakUrl = creds.keycloakUrl;
  const clientId = creds.clientId;
  const clientSecret = creds.clientSecret;
  const username = creds.username;
  const password = creds.password;

  if (!keycloakUrl || !clientId) {
    throw new Error("Missing Keycloak configuration");
  }

  const tokenUrl = keycloakUrl.endsWith("/protocol/openid-connect/token")
    ? keycloakUrl
    : `${keycloakUrl.replace(/\/+$/, "")}/protocol/openid-connect/token`;

  // Password grant flow
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify authentication
  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action, filter, buildingFmGuid } = body;

    // Resolve per-building credentials
    const creds = await getAssetPlusCredentials(supabase, buildingFmGuid);

    // Action: Get access token for 3D Viewer
    if (action === "getToken") {
      try {
        const accessToken = await getAccessToken(creds);
        return new Response(
          JSON.stringify({ accessToken }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("Token error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to get access token", accessToken: null }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Action: Get API configuration for 3D Viewer
    if (action === "getConfig") {
      const apiUrl = creds.apiUrl || "";
      const apiKey = creds.apiKey || "";
      
      return new Response(
        JSON.stringify({ 
          apiUrl: apiUrl.replace(/\/+$/, ""),
          apiKey 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Test 3D API endpoint with robust discovery
    if (action === "test3DApi") {
      try {
        const accessToken = await getAccessToken();
        const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
        const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";
        
        const testBuildingGuid = body.buildingFmGuid || "a8fe5835-e293-4ba3-92c6-c7e36f675f23";
        
        // Build candidate URLs to try
        const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
        const assetDbUrl = apiUrl.replace(/\/+$/, '');
        
        const candidatePaths = [
          `${baseUrl}/api/threed/GetModels`,
          `${baseUrl}/threed/GetModels`,
          `${assetDbUrl}/api/threed/GetModels`,
          `${assetDbUrl}/threed/GetModels`,
          `${assetDbUrl}/GetModels`,
        ];

        const results: any[] = [];
        let workingEndpoint: string | null = null;
        let workingData: any = null;

        for (const basePath of candidatePaths) {
          const urlWithQuery = `${basePath}?fmGuid=${testBuildingGuid}&apiKey=${apiKey}`;
          
          try {
            const res = await fetch(urlWithQuery, {
              headers: { "Authorization": `Bearer ${accessToken}` }
            });
            
            const status = res.status;
            let data: any = null;
            
            if (res.ok) {
              try {
                data = await res.json();
                if (Array.isArray(data) && !workingEndpoint) {
                  workingEndpoint = basePath;
                  workingData = data;
                }
              } catch {
                data = 'Invalid JSON';
              }
            }
            
            results.push({
              url: basePath,
              status,
              success: res.ok && Array.isArray(data),
              modelCount: Array.isArray(data) ? data.length : 0
            });
          } catch (e) {
            results.push({
              url: basePath,
              status: 'error',
              error: String(e)
            });
          }
        }
        
        return new Response(
          JSON.stringify({ 
            success: !!workingEndpoint,
            workingEndpoint,
            modelCount: Array.isArray(workingData) ? workingData.length : 0,
            models: workingData,
            testedEndpoints: results
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("3D API test error:", error);
        return new Response(
          JSON.stringify({ error: String(error) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Default: Query assets from database
    let query = supabase.from("assets").select("*");

    // Parse filter array: [["category", "=", "Building"], "or", ["category", "=", "Space"], ...]
    if (Array.isArray(filter) && filter.length > 0) {
      const categories: string[] = [];
      
      for (const item of filter) {
        if (Array.isArray(item) && item.length === 3) {
          const [field, op, value] = item;
          if (field === "category" && op === "=") {
            categories.push(value);
          }
        }
      }

      if (categories.length > 0) {
        query = query.in("category", categories);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database query error:", error);
      return new Response(
        JSON.stringify({ error: error.message, items: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map database columns to camelCase for frontend compatibility
    const items = (data || []).map((row: any) => ({
      fmGuid: row.fm_guid,
      category: row.category,
      name: row.name,
      commonName: row.common_name,
      complexCommonName: row.complex_common_name,
      buildingFmGuid: row.building_fm_guid,
      levelFmGuid: row.level_fm_guid,
      inRoomFmGuid: row.in_room_fm_guid,
      grossArea: row.gross_area,
      assetType: row.asset_type,
      attributes: row.attributes,
    }));

    return new Response(
      JSON.stringify({ items }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("asset-plus-query error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", items: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
