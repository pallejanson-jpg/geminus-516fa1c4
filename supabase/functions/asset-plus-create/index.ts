import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Property data types for Asset+ API
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

/**
 * Object types in Asset+ system
 * 0 = Complex
 * 1 = Building
 * 2 = Level (Building Storey)
 * 3 = Space
 * 4 = Instance (Asset/Door)
 */
const ObjectType = {
  Complex: 0,
  Building: 1,
  Level: 2,
  Space: 3,
  Instance: 4,
} as const;

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

interface CreateAssetRequest {
  // Generated fmGuid for the new asset
  fmGuid?: string;
  
  // Parent Space FM GUID - required for objectType 4
  parentSpaceFmGuid: string;
  
  // Basic asset info
  designation: string; // Primary name/number
  commonName?: string;
  
  // Extended properties with their data types
  properties?: Array<{
    name: string;
    value: string | number | boolean;
    dataType: number; // DataType enum value
  }>;
  
  // 3D coordinates for placement
  coordinates?: {
    x: number | null;
    y: number | null;
    z: number | null;
  };
}

interface BimObjectWithParent {
  fmGuid?: string;
  objectType: number;
  designation: string;
  commonName?: string;
  inRoomFmGuid?: string;
  properties?: Array<{
    name: string;
    value: string;
    dataType: number;
  }>;
}

interface AddObjectRequest {
  apiKey: string;
  bimObjectWithParent: BimObjectWithParent;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: CreateAssetRequest = await req.json();
    
    // Validate required fields
    if (!body.parentSpaceFmGuid) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "parentSpaceFmGuid is required - asset must be linked to a parent Space" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (!body.designation) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "designation (name/number) is required" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get authentication token
    const accessToken = await getAccessToken();
    
    // Get API configuration
    const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
    const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";
    
    if (!apiUrl) {
      return new Response(
        JSON.stringify({ success: false, error: "Asset+ API URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = apiUrl.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/AddObject`;

    // Build the bimObject payload - try flat structure without wrapper
    const bimObject: any = {
      objectType: ObjectType.Instance, // Type 4 for assets
      designation: body.designation,
      inRoomFmGuid: body.parentSpaceFmGuid, // Link to parent Space
    };

    // Use provided fmGuid or let Asset+ generate one
    if (body.fmGuid) {
      bimObject.fmGuid = body.fmGuid;
    }

    if (body.commonName) {
      bimObject.commonName = body.commonName;
    }

    // Convert properties to proper format with data types
    if (body.properties && body.properties.length > 0) {
      bimObject.properties = body.properties.map(prop => ({
        name: prop.name,
        value: String(prop.value), // API expects string values
        dataType: prop.dataType,
      }));
    }

    // Try alternative payload format - some Asset+ endpoints want flat structure with apiKey
    const requestPayload = {
      apiKey,
      ...bimObject, // Spread bimObject properties directly instead of nesting
    };

    console.log(`Creating asset in Asset+ API: ${endpoint}`);
    console.log("Payload:", JSON.stringify(requestPayload, null, 2));

    // Call Asset+ API
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestPayload),
    });

    const responseText = await response.text();
    console.log(`Asset+ API response: ${response.status} - ${responseText || "(empty)"}`);

    if (!response.ok) {
      let errorMessage = `Asset+ API error: ${response.status}`;
      try {
        if (responseText) {
          const errorData = JSON.parse(responseText);
          if (Array.isArray(errorData)) {
            // Validation failures array
            errorMessage = errorData.map((e: any) => e.errorMessage || e.message || JSON.stringify(e)).join(", ");
          } else if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          } else {
            errorMessage = JSON.stringify(errorData);
          }
        }
      } catch {
        errorMessage = responseText || errorMessage;
      }
      
      return new Response(
        JSON.stringify({ success: false, error: errorMessage }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse successful response
    let createdAsset;
    try {
      createdAsset = JSON.parse(responseText);
    } catch {
      createdAsset = { rawResponse: responseText };
    }

    // Also store locally with coordinates if provided
    if (body.coordinates) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          
          const assetFmGuid = createdAsset?.fmGuid || body.fmGuid;
          if (assetFmGuid) {
            // Upsert local record with coordinates
            await supabase
              .from("assets")
              .upsert({
                fm_guid: assetFmGuid,
                name: body.designation,
                common_name: body.commonName || null,
                category: "Instance",
                in_room_fm_guid: body.parentSpaceFmGuid,
                coordinate_x: body.coordinates.x,
                coordinate_y: body.coordinates.y,
                coordinate_z: body.coordinates.z,
                is_local: false, // Created in Asset+, so synced
                synced_at: new Date().toISOString(),
              }, { onConflict: "fm_guid" });
            
            console.log(`Stored asset ${assetFmGuid} locally with coordinates`);
          }
        }
      } catch (localError) {
        console.warn("Failed to store asset locally:", localError);
        // Don't fail the request - Asset+ creation succeeded
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        asset: createdAsset,
        message: "Asset created successfully"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("asset-plus-create error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Internal server error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
