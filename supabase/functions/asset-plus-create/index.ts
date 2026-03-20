import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

/**
 * Asset+ Create Edge Function
 * 
 * Creates objects in Asset+ using the AddObjectList endpoint.
 * Supports both room-parented and orphan (building-parented) objects.
 */

const ObjectType = {
  Complex: 0, Building: 1, Level: 2, Space: 3, Instance: 4,
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

// ============ TYPES ============

interface CreateAssetItem {
  fmGuid?: string;
  parentSpaceFmGuid?: string;
  parentBuildingFmGuid?: string;
  designation: string;
  commonName?: string;
  externalType?: string;
  properties?: Array<{
    name: string;
    value: string | number | boolean;
    dataType: number;
  }>;
  coordinates?: {
    x: number | null;
    y: number | null;
    z: number | null;
  };
}

interface CreateRequest {
  parentSpaceFmGuid?: string;
  parentBuildingFmGuid?: string;
  designation?: string;
  commonName?: string;
  externalType?: string;
  fmGuid?: string;
  properties?: Array<{
    name: string;
    value: string | number | boolean;
    dataType: number;
  }>;
  coordinates?: {
    x: number | null;
    y: number | null;
    z: number | null;
  };
  objects?: CreateAssetItem[];
}

interface CreateResult {
  fmGuid?: string;
  success: boolean;
  error?: string;
  asset?: any;
}

// ============ RESOLVE PARENT ============

/** Determine the parent GUID and building GUID for an item */
function resolveParent(item: CreateAssetItem): { parentFmGuid: string; isOrphan: boolean } {
  if (item.parentSpaceFmGuid) {
    return { parentFmGuid: item.parentSpaceFmGuid, isOrphan: false };
  }
  if (item.parentBuildingFmGuid) {
    return { parentFmGuid: item.parentBuildingFmGuid, isOrphan: true };
  }
  throw new Error("Either parentSpaceFmGuid or parentBuildingFmGuid is required");
}

// ============ CORE CREATE LOGIC ============

async function createSingleObject(
  item: CreateAssetItem,
  accessToken: string,
  apiUrl: string,
  apiKey: string,
  supabase: any,
): Promise<CreateResult> {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/AddObjectList`;

  const fmGuid = item.fmGuid || crypto.randomUUID();
  const { parentFmGuid, isOrphan } = resolveParent(item);

  const bimObject: Record<string, any> = {
    ObjectType: ObjectType.Instance,
    Designation: item.designation,
    CommonName: item.commonName || item.designation,
    APIKey: apiKey,
    FmGuid: fmGuid,
    UsedIdentifier: 1,
  };
  if (item.externalType) {
    bimObject.ExternalType = item.externalType;
  }

  const payload = {
    BimObjectWithParents: [{
      BimObject: bimObject,
      ParentFmGuid: parentFmGuid,
      UsedIdentifier: 1,
    }],
  };

  console.log(`Creating object ${item.designation} (${fmGuid}) under parent ${parentFmGuid} (orphan=${isOrphan})`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errorMessage = `Asset+ API error: ${response.status}`;
      try {
        if (responseText) {
          const errorData = JSON.parse(responseText);
          if (Array.isArray(errorData)) {
            errorMessage = errorData.map((e: any) => e.errorMessage || e.message || JSON.stringify(e)).join(", ");
          } else if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          }
        }
      } catch {
        errorMessage = responseText || errorMessage;
      }
      console.error(`AddObjectList failed: ${errorMessage}`);
      return { fmGuid, success: false, error: errorMessage };
    }

    let createdAsset: any;
    try {
      createdAsset = JSON.parse(responseText);
    } catch {
      createdAsset = { rawResponse: responseText };
    }

    // Resolve building_fm_guid
    let buildingFmGuid: string | null = isOrphan ? parentFmGuid : null;
    if (!isOrphan && supabase) {
      try {
        const { data: parentSpace } = await supabase
          .from("assets")
          .select("building_fm_guid")
          .eq("fm_guid", item.parentSpaceFmGuid)
          .maybeSingle();
        buildingFmGuid = parentSpace?.building_fm_guid || null;
      } catch {
        console.warn("Could not resolve building_fm_guid from parent space");
      }
    }

    // Store locally
    if (supabase) {
      try {
        await supabase
          .from("assets")
          .upsert({
            fm_guid: fmGuid,
            name: item.designation,
            common_name: item.commonName || null,
            category: "Instance",
            in_room_fm_guid: isOrphan ? null : item.parentSpaceFmGuid,
            building_fm_guid: buildingFmGuid,
            coordinate_x: item.coordinates?.x ?? null,
            coordinate_y: item.coordinates?.y ?? null,
            coordinate_z: item.coordinates?.z ?? null,
            is_local: false,
            synced_at: new Date().toISOString(),
          }, { onConflict: "fm_guid" });
      } catch (localError) {
        console.warn("Failed to store asset locally:", localError);
      }
    }

    // Update properties if any
    if (item.properties && item.properties.length > 0) {
      try {
        const propsEndpoint = `${baseUrl}/UpdateBimObjectsPropertiesData`;
        const propsPayload = {
          APIKey: apiKey,
          UpdateBimObjectProperties: [{
            FmGuid: fmGuid,
            UpdateProperties: item.properties.map(p => ({
              Name: p.name,
              Type: p.dataType,
              Value: String(p.value),
            })),
          }],
        };

        const propsRes = await fetch(propsEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify(propsPayload),
        });

        if (!propsRes.ok) {
          console.warn(`Property update failed for ${fmGuid}: ${propsRes.status}`);
        }
      } catch (propErr) {
        console.warn("Failed to update properties:", propErr);
      }
    }

    return { fmGuid, success: true, asset: createdAsset };
  } catch (error) {
    return {
      fmGuid,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function createBatchObjects(
  items: CreateAssetItem[],
  accessToken: string,
  apiUrl: string,
  apiKey: string,
  supabase: any,
): Promise<CreateResult[]> {
  const baseUrl = apiUrl.replace(/\/+$/, "");

  const bimObjectsWithParents = items.map(item => {
    const fmGuid = item.fmGuid || crypto.randomUUID();
    (item as any)._resolvedFmGuid = fmGuid;
    const { parentFmGuid } = resolveParent(item);

    const bimObject: Record<string, any> = {
      ObjectType: ObjectType.Instance,
      Designation: item.designation,
      CommonName: item.commonName || item.designation,
      APIKey: apiKey,
      FmGuid: fmGuid,
      UsedIdentifier: 1,
    };
    if (item.externalType) {
      bimObject.ExternalType = item.externalType;
    }

    return {
      BimObject: bimObject,
      ParentFmGuid: parentFmGuid,
      UsedIdentifier: 1,
    };
  });

  const batchPayload = { BimObjectWithParents: bimObjectsWithParents };

  try {
    const endpoint = `${baseUrl}/AddObjectList`;
    console.log(`Batch creating ${items.length} objects via AddObjectList`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(batchPayload),
    });

    const responseText = await response.text();
    console.log(`AddObjectList response: ${response.status}`);

    if (response.ok) {
      let createdList: any[];
      try {
        createdList = JSON.parse(responseText);
        if (!Array.isArray(createdList)) createdList = [createdList];
      } catch {
        createdList = [];
      }

      const results: CreateResult[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const created = createdList[i];
        const assetFmGuid = (item as any)._resolvedFmGuid || created?.fmGuid || item.fmGuid;
        const { isOrphan } = resolveParent(item);

        if (assetFmGuid && supabase) {
          let buildingFmGuid: string | null = isOrphan ? (item.parentBuildingFmGuid || null) : null;
          if (!isOrphan) {
            try {
              const { data: parentSpace } = await supabase
                .from("assets")
                .select("building_fm_guid")
                .eq("fm_guid", item.parentSpaceFmGuid)
                .maybeSingle();
              buildingFmGuid = parentSpace?.building_fm_guid || null;
            } catch { /* ignore */ }
          }

          try {
            await supabase
              .from("assets")
              .upsert({
                fm_guid: assetFmGuid,
                name: item.designation,
                common_name: item.commonName || null,
                category: "Instance",
                in_room_fm_guid: isOrphan ? null : item.parentSpaceFmGuid,
                building_fm_guid: buildingFmGuid,
                coordinate_x: item.coordinates?.x ?? null,
                coordinate_y: item.coordinates?.y ?? null,
                coordinate_z: item.coordinates?.z ?? null,
                is_local: false,
                synced_at: new Date().toISOString(),
              }, { onConflict: "fm_guid" });
          } catch (e) {
            console.warn(`Failed to store ${assetFmGuid} locally:`, e);
          }
        }

        results.push({ fmGuid: assetFmGuid, success: true, asset: created });
      }
      return results;
    }

    console.log("AddObjectList batch failed, falling back to individual calls");
  } catch (batchError) {
    console.log("AddObjectList not available, using individual calls:", batchError);
  }

  // Fallback: create one by one
  const results: CreateResult[] = [];
  for (const item of items) {
    const result = await createSingleObject(item, accessToken, apiUrl, apiKey, supabase);
    results.push(result);
  }
  return results;
}

// ============ SERVE ============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const body: CreateRequest = await req.json();

    // Determine if batch or single mode
    const isBatch = Array.isArray(body.objects) && body.objects.length > 0;
    const items: CreateAssetItem[] = isBatch
      ? body.objects!
      : [{
          fmGuid: body.fmGuid,
          parentSpaceFmGuid: body.parentSpaceFmGuid || undefined,
          parentBuildingFmGuid: body.parentBuildingFmGuid || undefined,
          designation: body.designation || "",
          commonName: body.commonName,
          properties: body.properties,
          coordinates: body.coordinates,
        }];

    // Validate all items
    for (const item of items) {
      if (!item.parentSpaceFmGuid && !item.parentBuildingFmGuid) {
        return new Response(
          JSON.stringify({ success: false, error: "Either parentSpaceFmGuid or parentBuildingFmGuid is required for all objects" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!item.designation) {
        return new Response(
          JSON.stringify({ success: false, error: "designation is required for all objects" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Limit batch size
    if (items.length > 100) {
      return new Response(
        JSON.stringify({ success: false, error: "Maximum 100 objects per request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getAccessToken();
    const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
    const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";

    if (!apiUrl) {
      return new Response(
        JSON.stringify({ success: false, error: "Asset+ API URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

    let results: CreateResult[];

    if (items.length === 1) {
      const result = await createSingleObject(items[0], accessToken, apiUrl, apiKey, supabase);
      results = [result];
    } else {
      results = await createBatchObjects(items, accessToken, apiUrl, apiKey, supabase);
    }

    const summary = {
      total: items.length,
      created: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };

    // Backward compatible: single mode returns asset directly
    if (!isBatch) {
      const result = results[0];
      if (!result.success) {
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ success: true, asset: result.asset, message: "Asset created successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch mode returns full results
    return new Response(
      JSON.stringify({ success: summary.failed === 0, results, summary }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("asset-plus-create error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
