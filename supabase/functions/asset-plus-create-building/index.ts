import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

/**
 * Asset+ Create Building Edge Function
 * 
 * Creates a Complex (ObjectType 0) + Building (ObjectType 1) hierarchy in Asset+
 * and stores both locally in the assets table + building_settings.
 * 
 * Payload format follows Asset+ AddObjectList spec:
 * - Complex: no ParentFmGuid, ObjectType 0
 * - Building: ParentFmGuid = Complex FmGuid, ObjectType 1
 */

const ObjectType = { Complex: 0, Building: 1 } as const;

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
      grant_type: "password", username, password, client_id: clientId,
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

interface CreateBuildingRequest {
  complexDesignation: string;
  complexName: string;
  buildingDesignation: string;
  buildingName: string;
  latitude?: number | null;
  longitude?: number | null;
}

async function addObjectToAssetPlus(
  apiUrl: string,
  apiKey: string,
  accessToken: string,
  payload: any
): Promise<any> {
  const endpoint = `${apiUrl.replace(/\/+$/, "")}/AddObjectList`;
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  
  if (!response.ok) {
    let errorMsg = `Asset+ API error: ${response.status}`;
    try {
      const errorData = JSON.parse(text);
      if (Array.isArray(errorData)) {
        errorMsg = errorData.map((e: any) => e.errorMessage || e.message || JSON.stringify(e)).join(", ");
      } else if (errorData.message || errorData.error) {
        errorMsg = errorData.message || errorData.error;
      }
    } catch {
      errorMsg = text || errorMsg;
    }
    throw new Error(errorMsg);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { rawResponse: text };
  }
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
    const body: CreateBuildingRequest = await req.json();

    // Validate required fields
    if (!body.complexDesignation || !body.complexName) {
      return new Response(
        JSON.stringify({ success: false, error: "complexDesignation och complexName krävs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!body.buildingDesignation || !body.buildingName) {
      return new Response(
        JSON.stringify({ success: false, error: "buildingDesignation och buildingName krävs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getAccessToken();
    const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
    const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";

    if (!apiUrl || !apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Asset+ API inte konfigurerat" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate FMGUIDs
    const complexFmGuid = crypto.randomUUID();
    const buildingFmGuid = crypto.randomUUID();

    // Step 1: Create Complex (ObjectType 0)
    console.log(`Creating Complex: ${body.complexDesignation} (${complexFmGuid})`);
    const complexPayload = {
      BimObjectWithParents: [{
        BimObject: {
          ObjectType: ObjectType.Complex,
          Designation: body.complexDesignation,
          CommonName: body.complexName,
          APIKey: apiKey,
          FmGuid: complexFmGuid,
          UsedIdentifier: 1,
        },
      }],
    };

    const complexResult = await addObjectToAssetPlus(apiUrl, apiKey, accessToken, complexPayload);
    console.log("Complex created:", JSON.stringify(complexResult).slice(0, 200));

    // Step 2: Create Building (ObjectType 1) under Complex
    console.log(`Creating Building: ${body.buildingDesignation} (${buildingFmGuid}) under Complex ${complexFmGuid}`);
    const buildingPayload = {
      BimObjectWithParents: [{
        ParentFmGuid: complexFmGuid,
        UsedIdentifier: 1,
        BimObject: {
          ObjectType: ObjectType.Building,
          Designation: body.buildingDesignation,
          CommonName: body.buildingName,
          APIKey: apiKey,
          FmGuid: buildingFmGuid,
          UsedIdentifier: 1,
        },
      }],
    };

    const buildingResult = await addObjectToAssetPlus(apiUrl, apiKey, accessToken, buildingPayload);
    console.log("Building created:", JSON.stringify(buildingResult).slice(0, 200));

    // Step 3: Store locally using service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Insert Complex into assets
    const { error: complexDbError } = await supabase
      .from("assets")
      .upsert({
        fm_guid: complexFmGuid,
        name: body.complexDesignation,
        common_name: body.complexName,
        category: "Complex",
        is_local: false,
        synced_at: new Date().toISOString(),
      }, { onConflict: "fm_guid" });

    if (complexDbError) {
      console.warn("Failed to store Complex locally:", complexDbError);
    }

    // Insert Building into assets
    const { error: buildingDbError } = await supabase
      .from("assets")
      .upsert({
        fm_guid: buildingFmGuid,
        name: body.buildingDesignation,
        common_name: body.buildingName,
        complex_common_name: body.complexName,
        category: "Building",
        building_fm_guid: buildingFmGuid,
        is_local: false,
        synced_at: new Date().toISOString(),
      }, { onConflict: "fm_guid" });

    if (buildingDbError) {
      console.warn("Failed to store Building locally:", buildingDbError);
    }

    // Create building_settings entry
    const { error: settingsError } = await supabase
      .from("building_settings")
      .upsert({
        fm_guid: buildingFmGuid,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        is_favorite: true,
      }, { onConflict: "fm_guid" });

    if (settingsError) {
      console.warn("Failed to create building_settings:", settingsError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        complexFmGuid,
        buildingFmGuid,
        message: `Fastighet "${body.complexName}" och byggnad "${body.buildingName}" skapade i Asset+`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("asset-plus-create-building error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internt serverfel",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
