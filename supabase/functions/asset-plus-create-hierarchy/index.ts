import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

/**
 * Asset+ Create Hierarchy Edge Function
 *
 * Creates Levels (ObjectType 2) and Spaces (ObjectType 3) in Asset+
 * from parsed IFC metadata, then stores them locally.
 */

const ObjectType = { Level: 2, Space: 3 } as const;

interface HierarchyItem {
  fmGuid: string;
  designation: string;
  commonName: string;
}

interface SpaceItem extends HierarchyItem {
  levelFmGuid?: string;
}

interface CreateHierarchyRequest {
  buildingFmGuid: string;
  modelFmGuid: string;
  levels: HierarchyItem[];
  spaces: SpaceItem[];
}

async function getAccessToken(): Promise<string> {
  const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
  const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
  const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
  const username = Deno.env.get("ASSET_PLUS_USERNAME");
  const password = Deno.env.get("ASSET_PLUS_PASSWORD");

  if (!keycloakUrl || !clientId) throw new Error("Missing Keycloak configuration");

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

async function callAssetPlusApi(apiUrl: string, accessToken: string, endpoint: string, payload: any): Promise<any> {
  const url = `${apiUrl.replace(/\/+$/, "")}/${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Asset+ ${endpoint} error ${response.status}: ${text.slice(0, 300)}`);
  }

  try { return JSON.parse(text); } catch { return { rawResponse: text }; }
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
    const body: CreateHierarchyRequest = await req.json();

    if (!body.buildingFmGuid || !body.modelFmGuid) {
      return new Response(
        JSON.stringify({ success: false, error: "buildingFmGuid och modelFmGuid krävs" }),
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    let levelsCreated = 0;
    let spacesCreated = 0;

    // Step 1: Create Levels (ObjectType 2) under Building
    if (body.levels?.length) {
      console.log(`Creating ${body.levels.length} levels under Building ${body.buildingFmGuid}`);

      const levelObjects = body.levels.map(level => ({
        ParentFmGuid: body.buildingFmGuid,
        UsedIdentifier: 1,
        BimObject: {
          ObjectType: ObjectType.Level,
          Designation: level.designation,
          CommonName: level.commonName,
          APIKey: apiKey,
          FmGuid: level.fmGuid,
          UsedIdentifier: 1,
        },
      }));

      await callAssetPlusApi(apiUrl, accessToken, "AddObjectList", {
        BimObjectWithParents: levelObjects,
      });

      // Store levels locally
      const levelRows = body.levels.map(level => ({
        fm_guid: level.fmGuid,
        name: level.designation,
        common_name: level.commonName,
        category: "Level",
        building_fm_guid: body.buildingFmGuid,
        level_fm_guid: level.fmGuid,
        is_local: false,
        created_in_model: false,
        synced_at: new Date().toISOString(),
      }));

      await supabase.from("assets").upsert(levelRows, { onConflict: "fm_guid" });
      levelsCreated = body.levels.length;
    }

    // Step 2: Create Spaces (ObjectType 3) under Building
    if (body.spaces?.length) {
      console.log(`Creating ${body.spaces.length} spaces under Building ${body.buildingFmGuid}`);

      const spaceObjects = body.spaces.map(space => ({
        ParentFmGuid: body.buildingFmGuid,
        UsedIdentifier: 1,
        BimObject: {
          ObjectType: ObjectType.Space,
          Designation: space.designation,
          CommonName: space.commonName,
          APIKey: apiKey,
          FmGuid: space.fmGuid,
          UsedIdentifier: 1,
        },
      }));

      await callAssetPlusApi(apiUrl, accessToken, "AddObjectList", {
        BimObjectWithParents: spaceObjects,
      });

      // Step 3: Move Spaces under their Level via UpsertRelationships
      const spacesWithLevel = body.spaces.filter(s => s.levelFmGuid);
      if (spacesWithLevel.length) {
        console.log(`Moving ${spacesWithLevel.length} spaces to their levels via UpsertRelationships`);
        const relationships = spacesWithLevel.map(space => ({
          ChildFmGuid: space.fmGuid,
          ParentFmGuid: space.levelFmGuid,
          APIKey: apiKey,
        }));

        await callAssetPlusApi(apiUrl, accessToken, "UpsertRelationships", {
          Relationships: relationships,
        });
      }

      // Store spaces locally
      const spaceRows = body.spaces.map(space => ({
        fm_guid: space.fmGuid,
        name: space.designation,
        common_name: space.commonName,
        category: "Space",
        building_fm_guid: body.buildingFmGuid,
        level_fm_guid: space.levelFmGuid || null,
        is_local: false,
        created_in_model: false,
        synced_at: new Date().toISOString(),
      }));

      await supabase.from("assets").upsert(spaceRows, { onConflict: "fm_guid" });
      spacesCreated = body.spaces.length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        levelsCreated,
        spacesCreated,
        message: `Skapade ${levelsCreated} våningsplan och ${spacesCreated} rum i Asset+`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("asset-plus-create-hierarchy error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internt serverfel",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
