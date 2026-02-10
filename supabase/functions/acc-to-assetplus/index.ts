import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/auth.ts";

/**
 * acc-to-assetplus: Syncs ACC-sourced objects from the local database to Asset+ API.
 * 
 * Flow:
 * 1. Fetch ACC objects from `assets` table (source = 'acc-bim')
 * 2. For each building: create Complex -> Building -> Levels -> Spaces -> Instances in Asset+
 * 3. Store GUID mappings in `acc_assetplus_guid_map`
 * 4. Set relationships and properties via Asset+ API
 */

const ObjectType = { Complex: 0, Building: 1, Level: 2, Space: 3, Instance: 4 } as const;

// ============ Asset+ Auth ============

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

  const params = new URLSearchParams({ grant_type: "password", username: username!, password: password!, client_id: clientId });
  if (clientSecret) params.set("client_secret", clientSecret);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!res.ok) throw new Error(`Keycloak auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// ============ Asset+ API helpers ============

async function assetPlusPost(endpoint: string, body: any, accessToken: string): Promise<any> {
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL")!.replace(/\/+$/, "");
  const url = `${apiUrl}/${endpoint}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Asset+ ${endpoint} failed (${res.status}):`, text.substring(0, 500));
    throw new Error(`Asset+ ${endpoint}: ${res.status} - ${text.substring(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ============ GUID Mapping ============

async function getOrCreateGuid(
  supabase: any,
  accFmGuid: string,
  objectType: number
): Promise<string> {
  // Check existing mapping
  const { data: existing } = await supabase
    .from("acc_assetplus_guid_map")
    .select("assetplus_fm_guid")
    .eq("acc_fm_guid", accFmGuid)
    .maybeSingle();

  if (existing?.assetplus_fm_guid) {
    return existing.assetplus_fm_guid;
  }

  // Generate new UUID
  const newGuid = crypto.randomUUID();
  await supabase
    .from("acc_assetplus_guid_map")
    .insert({
      acc_fm_guid: accFmGuid,
      assetplus_fm_guid: newGuid,
      object_type: objectType,
    });

  return newGuid;
}

async function markSynced(supabase: any, accFmGuid: string): Promise<void> {
  await supabase
    .from("acc_assetplus_guid_map")
    .update({ synced_at: new Date().toISOString() })
    .eq("acc_fm_guid", accFmGuid);
}

// ============ AddObjectList wrapper ============

interface AddObjectItem {
  objectType: number;
  fmGuid: string;
  designation: string;
  commonName: string;
  parentFmGuid?: string;
}

async function addObjectList(
  items: AddObjectItem[],
  accessToken: string,
  apiKey: string
): Promise<any> {
  if (items.length === 0) return [];

  const payload = {
    BimObjectWithParents: items.map(item => {
      const obj: any = {
        BimObject: {
          ObjectType: item.objectType,
          Designation: item.designation,
          CommonName: item.commonName,
          APIKey: apiKey,
          FmGuid: item.fmGuid,
          UsedIdentifier: 1,
        },
      };
      if (item.parentFmGuid) {
        obj.ParentFmGuid = item.parentFmGuid;
        obj.UsedIdentifier = 1;
      }
      return obj;
    }),
  };

  return await assetPlusPost("AddObjectList", payload, accessToken);
}

// ============ UpsertRelationships wrapper ============

async function upsertRelationships(
  relationships: Array<{ parentFmGuid: string; childFmGuid: string }>,
  accessToken: string,
  apiKey: string
): Promise<any> {
  if (relationships.length === 0) return null;

  const payload = {
    APIKey: apiKey,
    Relationships: relationships.map(r => ({
      FmGuid1: r.parentFmGuid,
      FmGuid2: r.childFmGuid,
    })),
  };

  return await assetPlusPost("UpsertRelationships", payload, accessToken);
}

// ============ UpdateBimObjectsPropertiesData wrapper ============

async function updateProperties(
  updates: Array<{
    fmGuid: string;
    properties: Array<{ name: string; type: number; value: string }>;
  }>,
  accessToken: string,
  apiKey: string
): Promise<any> {
  if (updates.length === 0) return null;

  const payload = {
    APIKey: apiKey,
    UpdateBimObjectProperties: updates.map(u => ({
      FmGuid: u.fmGuid,
      UpdateProperties: u.properties.map(p => ({
        Name: p.name,
        Type: p.type,
        Value: p.value,
      })),
    })),
  };

  return await assetPlusPost("UpdateBimObjectsPropertiesData", payload, accessToken);
}

// ============ Check if object exists in Asset+ ============

async function checkExistsInAssetPlus(
  fmGuid: string,
  accessToken: string,
  apiKey: string
): Promise<boolean> {
  try {
    const result = await assetPlusPost("PublishDataServiceGetMerged", {
      outputType: "raw",
      apiKey,
      filter: ["fmGuid", "=", fmGuid],
      select: ["fmGuid"],
    }, accessToken);
    return result?.data?.length > 0;
  } catch {
    return false;
  }
}

// ============ Main sync logic ============

interface SyncResult {
  building: string;
  buildingName: string;
  created: { complexes: number; buildings: number; levels: number; spaces: number; instances: number };
  relationships: number;
  propertiesUpdated: number;
  errors: string[];
}

async function syncBuildingToAssetPlus(
  supabase: any,
  buildingFmGuid: string,
  complexFmGuid: string,
  accessToken: string,
  apiKey: string
): Promise<SyncResult> {
  const result: SyncResult = {
    building: buildingFmGuid,
    buildingName: "",
    created: { complexes: 0, buildings: 0, levels: 0, spaces: 0, instances: 0 },
    relationships: 0,
    propertiesUpdated: 0,
    errors: [],
  };

  try {
    // Fetch all ACC objects for this building
    const { data: allObjects, error: fetchErr } = await supabase
      .from("assets")
      .select("*")
      .eq("building_fm_guid", buildingFmGuid)
      .or("fm_guid.like.acc-bim-%,fm_guid.like.acc-%");

    if (fetchErr) throw new Error(`Failed to fetch objects: ${fetchErr.message}`);
    if (!allObjects?.length) {
      // Also fetch the building itself
      const { data: buildingObj } = await supabase
        .from("assets")
        .select("*")
        .eq("fm_guid", buildingFmGuid)
        .maybeSingle();
      
      if (!buildingObj) {
        result.errors.push("No objects found for this building");
        return result;
      }
      allObjects.push(buildingObj);
    }

    // Also fetch the building record itself if not in the result
    const buildingObj = allObjects.find((o: any) => o.fm_guid === buildingFmGuid) 
      || (await supabase.from("assets").select("*").eq("fm_guid", buildingFmGuid).maybeSingle()).data;
    
    if (!buildingObj) {
      result.errors.push("Building object not found");
      return result;
    }

    result.buildingName = buildingObj.common_name || buildingObj.name || buildingFmGuid;

    // Categorize objects
    const levels = allObjects.filter((o: any) => o.category === "Level");
    const spaces = allObjects.filter((o: any) => o.category === "Space");
    const instances = allObjects.filter((o: any) => o.category === "Instance");

    console.log(`Building ${result.buildingName}: ${levels.length} levels, ${spaces.length} spaces, ${instances.length} instances`);

    // Step 1: Get/create Asset+ GUIDs
    const buildingApGuid = await getOrCreateGuid(supabase, buildingFmGuid, ObjectType.Building);

    // Step 2: Check if building already exists in Asset+
    const buildingExists = await checkExistsInAssetPlus(buildingApGuid, accessToken, apiKey);

    if (!buildingExists) {
      // Create building in Asset+
      const designation = buildingObj.name || buildingObj.common_name || "ACC-Building";
      const commonName = buildingObj.common_name || buildingObj.name || "ACC-Building";

      try {
        await addObjectList([{
          objectType: ObjectType.Building,
          fmGuid: buildingApGuid,
          designation,
          commonName,
          parentFmGuid: complexFmGuid,
        }], accessToken, apiKey);
        result.created.buildings = 1;
        await markSynced(supabase, buildingFmGuid);
        console.log(`Created building ${commonName} (${buildingApGuid})`);
      } catch (err: any) {
        result.errors.push(`Building creation failed: ${err.message}`);
        return result; // Can't proceed without building
      }
    }

    // Step 3: Create Levels
    const levelGuids: Record<string, string> = {};
    if (levels.length > 0) {
      const levelItems: AddObjectItem[] = [];
      for (const level of levels) {
        const apGuid = await getOrCreateGuid(supabase, level.fm_guid, ObjectType.Level);
        levelGuids[level.fm_guid] = apGuid;
        
        const exists = await checkExistsInAssetPlus(apGuid, accessToken, apiKey);
        if (!exists) {
          levelItems.push({
            objectType: ObjectType.Level,
            fmGuid: apGuid,
            designation: level.name || level.common_name || "Level",
            commonName: level.common_name || level.name || "Level",
            parentFmGuid: buildingApGuid,
          });
        }
      }

      if (levelItems.length > 0) {
        try {
          await addObjectList(levelItems, accessToken, apiKey);
          result.created.levels = levelItems.length;
          for (const level of levels) {
            await markSynced(supabase, level.fm_guid);
          }
          console.log(`Created ${levelItems.length} levels`);
        } catch (err: any) {
          result.errors.push(`Level creation failed: ${err.message}`);
        }
      }
    }

    // Step 4: Create Spaces
    const spaceGuids: Record<string, string> = {};
    if (spaces.length > 0) {
      const spaceItems: AddObjectItem[] = [];
      for (const space of spaces) {
        const apGuid = await getOrCreateGuid(supabase, space.fm_guid, ObjectType.Space);
        spaceGuids[space.fm_guid] = apGuid;

        const exists = await checkExistsInAssetPlus(apGuid, accessToken, apiKey);
        if (!exists) {
          spaceItems.push({
            objectType: ObjectType.Space,
            fmGuid: apGuid,
            designation: space.name || space.common_name || "Space",
            commonName: space.common_name || space.name || "Space",
            parentFmGuid: buildingApGuid,
          });
        }
      }

      if (spaceItems.length > 0) {
        try {
          await addObjectList(spaceItems, accessToken, apiKey);
          result.created.spaces = spaceItems.length;
          for (const space of spaces) {
            await markSynced(supabase, space.fm_guid);
          }
          console.log(`Created ${spaceItems.length} spaces`);
        } catch (err: any) {
          result.errors.push(`Space creation failed: ${err.message}`);
        }
      }
    }

    // Step 5: Create Instances (in batches of 50)
    const instanceGuids: Record<string, string> = {};
    if (instances.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < instances.length; i += BATCH_SIZE) {
        const batch = instances.slice(i, i + BATCH_SIZE);
        const instanceItems: AddObjectItem[] = [];
        
        for (const inst of batch) {
          const apGuid = await getOrCreateGuid(supabase, inst.fm_guid, ObjectType.Instance);
          instanceGuids[inst.fm_guid] = apGuid;

          const exists = await checkExistsInAssetPlus(apGuid, accessToken, apiKey);
          if (!exists) {
            instanceItems.push({
              objectType: ObjectType.Instance,
              fmGuid: apGuid,
              designation: inst.name || inst.common_name || "",
              commonName: inst.common_name || inst.name || "",
              parentFmGuid: buildingApGuid,
            });
          }
        }

        if (instanceItems.length > 0) {
          try {
            await addObjectList(instanceItems, accessToken, apiKey);
            result.created.instances += instanceItems.length;
            for (const inst of batch) {
              await markSynced(supabase, inst.fm_guid);
            }
            console.log(`Created ${instanceItems.length} instances (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
          } catch (err: any) {
            result.errors.push(`Instance batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
          }
        }
      }
    }

    // Step 6: Set relationships (Space -> Level, Instance -> Space)
    const rels: Array<{ parentFmGuid: string; childFmGuid: string }> = [];

    // Space -> Level relationships
    for (const space of spaces) {
      if (space.level_fm_guid && levelGuids[space.level_fm_guid] && spaceGuids[space.fm_guid]) {
        rels.push({
          parentFmGuid: levelGuids[space.level_fm_guid],
          childFmGuid: spaceGuids[space.fm_guid],
        });
      }
    }

    // Instance -> Space relationships
    for (const inst of instances) {
      if (inst.in_room_fm_guid && spaceGuids[inst.in_room_fm_guid] && instanceGuids[inst.fm_guid]) {
        rels.push({
          parentFmGuid: spaceGuids[inst.in_room_fm_guid],
          childFmGuid: instanceGuids[inst.fm_guid],
        });
      }
    }

    if (rels.length > 0) {
      try {
        // Batch relationships in chunks of 100
        for (let i = 0; i < rels.length; i += 100) {
          const batch = rels.slice(i, i + 100);
          await upsertRelationships(batch, accessToken, apiKey);
        }
        result.relationships = rels.length;
        console.log(`Set ${rels.length} relationships`);
      } catch (err: any) {
        result.errors.push(`Relationships failed: ${err.message}`);
      }
    }

    // Step 7: Update properties (commonName, designation) for all objects
    const propUpdates: Array<{ fmGuid: string; properties: Array<{ name: string; type: number; value: string }> }> = [];

    // Building properties
    if (buildingObj.common_name || buildingObj.name) {
      propUpdates.push({
        fmGuid: buildingApGuid,
        properties: [
          ...(buildingObj.common_name ? [{ name: "commonName", type: 0, value: buildingObj.common_name }] : []),
          ...(buildingObj.name ? [{ name: "designation", type: 0, value: buildingObj.name }] : []),
        ],
      });
    }

    // Level/Space/Instance properties
    for (const obj of [...levels, ...spaces, ...instances]) {
      const apGuid = levelGuids[obj.fm_guid] || spaceGuids[obj.fm_guid] || instanceGuids[obj.fm_guid];
      if (!apGuid) continue;

      const props: Array<{ name: string; type: number; value: string }> = [];
      if (obj.common_name) props.push({ name: "commonName", type: 0, value: obj.common_name });
      if (obj.name) props.push({ name: "designation", type: 0, value: obj.name });
      
      if (props.length > 0) {
        propUpdates.push({ fmGuid: apGuid, properties: props });
      }
    }

    if (propUpdates.length > 0) {
      try {
        // Batch property updates in chunks of 50
        for (let i = 0; i < propUpdates.length; i += 50) {
          const batch = propUpdates.slice(i, i + 50);
          await updateProperties(batch, accessToken, apiKey);
        }
        result.propertiesUpdated = propUpdates.length;
        console.log(`Updated properties for ${propUpdates.length} objects`);
      } catch (err: any) {
        result.errors.push(`Property updates failed: ${err.message}`);
      }
    }

    // Step 8: Update local assets with Asset+ GUID mappings
    for (const obj of allObjects) {
      const apGuid = obj.fm_guid === buildingFmGuid
        ? buildingApGuid
        : (levelGuids[obj.fm_guid] || spaceGuids[obj.fm_guid] || instanceGuids[obj.fm_guid]);
      
      if (apGuid) {
        const attrs = (obj.attributes && typeof obj.attributes === 'object') ? obj.attributes : {};
        await supabase
          .from("assets")
          .update({
            attributes: {
              ...attrs,
              assetplus_fm_guid: apGuid,
              synced_to_assetplus: true,
              synced_to_assetplus_at: new Date().toISOString(),
            },
          })
          .eq("fm_guid", obj.fm_guid);
      }
    }

  } catch (err: any) {
    result.errors.push(`Unexpected error: ${err.message}`);
  }

  return result;
}

// ============ Actions ============

async function handleCheckStatus(supabase: any): Promise<Response> {
  // Count ACC objects not yet synced to Asset+
  const { count: totalAcc } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .or("fm_guid.like.acc-bim-%,fm_guid.like.acc-%");

  const { count: syncedCount } = await supabase
    .from("acc_assetplus_guid_map")
    .select("*", { count: "exact", head: true })
    .not("synced_at", "is", null);

  // Get buildings
  const { data: accBuildings } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name")
    .eq("category", "Building")
    .or("fm_guid.like.acc-bim-building-%,fm_guid.like.acc-building-%");

  // Check which buildings are already synced
  const buildingStatuses = [];
  for (const b of (accBuildings || [])) {
    const { data: mapping } = await supabase
      .from("acc_assetplus_guid_map")
      .select("synced_at, assetplus_fm_guid")
      .eq("acc_fm_guid", b.fm_guid)
      .maybeSingle();

    // Count children
    const { count: childCount } = await supabase
      .from("assets")
      .select("*", { count: "exact", head: true })
      .eq("building_fm_guid", b.fm_guid)
      .or("fm_guid.like.acc-bim-%,fm_guid.like.acc-%");

    buildingStatuses.push({
      accFmGuid: b.fm_guid,
      name: b.common_name || b.name || b.fm_guid,
      synced: !!mapping?.synced_at,
      assetplusFmGuid: mapping?.assetplus_fm_guid || null,
      childCount: childCount || 0,
    });
  }

  return new Response(JSON.stringify({
    success: true,
    totalAccObjects: totalAcc || 0,
    syncedToAssetPlus: syncedCount || 0,
    unsyncedCount: (totalAcc || 0) - (syncedCount || 0),
    buildings: buildingStatuses,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleSync(
  supabase: any,
  body: any
): Promise<Response> {
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";

  if (!apiUrl || !apiKey) {
    return new Response(JSON.stringify({ success: false, error: "Asset+ API not configured" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const accessToken = await getAccessToken();

  // Determine complex to use
  let complexFmGuid = body.complexFmGuid;
  
  if (!complexFmGuid) {
    // Try to find an existing complex in Asset+
    try {
      const result = await assetPlusPost("PublishDataServiceGetMerged", {
        outputType: "raw",
        apiKey,
        filter: ["objectType", "=", 0],
        select: ["fmGuid", "commonName", "designation"],
      }, accessToken);

      if (result?.data?.length > 0) {
        complexFmGuid = result.data[0].fmGuid;
        console.log(`Using existing complex: ${result.data[0].commonName} (${complexFmGuid})`);
      }
    } catch (err) {
      console.warn("Failed to fetch existing complexes:", err);
    }
  }

  if (!complexFmGuid) {
    // Create a default complex
    complexFmGuid = crypto.randomUUID();
    try {
      await addObjectList([{
        objectType: ObjectType.Complex,
        fmGuid: complexFmGuid,
        designation: "ACC Import",
        commonName: "ACC Import",
      }], accessToken, apiKey);
      console.log(`Created default complex: ACC Import (${complexFmGuid})`);
    } catch (err: any) {
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to create Complex: ${err.message}`,
      }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Get ACC buildings to sync
  const { data: accBuildings } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name")
    .eq("category", "Building")
    .or("fm_guid.like.acc-bim-building-%,fm_guid.like.acc-building-%");

  if (!accBuildings?.length) {
    return new Response(JSON.stringify({
      success: true,
      message: "No ACC buildings found to sync",
      results: [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Optionally filter to specific building
  const targetBuilding = body.buildingFmGuid;
  const buildings = targetBuilding
    ? accBuildings.filter((b: any) => b.fm_guid === targetBuilding)
    : accBuildings;

  const results: SyncResult[] = [];
  
  for (const building of buildings) {
    console.log(`\n=== Syncing building: ${building.common_name || building.name} ===`);
    const result = await syncBuildingToAssetPlus(
      supabase,
      building.fm_guid,
      complexFmGuid,
      accessToken,
      apiKey
    );
    results.push(result);
  }

  const totalCreated = results.reduce((acc, r) => ({
    complexes: acc.complexes + r.created.complexes,
    buildings: acc.buildings + r.created.buildings,
    levels: acc.levels + r.created.levels,
    spaces: acc.spaces + r.created.spaces,
    instances: acc.instances + r.created.instances,
  }), { complexes: 0, buildings: 0, levels: 0, spaces: 0, instances: 0 });

  const totalErrors = results.reduce((acc, r) => acc + r.errors.length, 0);

  return new Response(JSON.stringify({
    success: totalErrors === 0,
    results,
    summary: {
      buildingsSynced: results.length,
      created: totalCreated,
      totalRelationships: results.reduce((acc, r) => acc + r.relationships, 0),
      totalPropertiesUpdated: results.reduce((acc, r) => acc + r.propertiesUpdated, 0),
      totalErrors,
    },
    complexFmGuid,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============ Serve ============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action || "sync";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    switch (action) {
      case "check-status":
        return await handleCheckStatus(supabase);

      case "sync":
        return await handleSync(supabase, body);

      default:
        return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err: any) {
    console.error("acc-to-assetplus error:", err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message || "Internal server error",
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
