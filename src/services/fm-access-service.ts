import { supabase } from "@/integrations/supabase/client";

/**
 * FM Access (Tessel HDC) service layer.
 * Provides CRUD operations for the FASTIGHET/BYGGNAD/PLAN/RUM/OBJEKT hierarchy.
 */

// ── Read operations ────────────────────────────────────────────────

/**
 * Get full hierarchy tree for a building from FM Access.
 */
export async function getFmAccessHierarchy(buildingFmGuid: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("fm-access-query", {
    body: { action: "get-hierarchy", buildingFmGuid },
  });
  if (error) throw new Error(error.message || "Failed to get FM Access hierarchy");
  if (!data?.success) throw new Error(data?.error || "FM Access hierarchy fetch failed");
  return data.data;
}

/**
 * Get object details by GUID from FM Access.
 */
export async function getFmAccessObject(guid: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("fm-access-query", {
    body: { action: "get-object-by-guid", guid },
  });
  if (error) throw new Error(error.message || "Failed to get FM Access object");
  if (!data?.success) throw new Error(data?.error || "FM Access object fetch failed");
  return data.data;
}

// ── Create operations ──────────────────────────────────────────────

export interface FmAccessCreatePayload {
  parentGuid: string;
  name: string;
  classId?: number; // HDC class IDs: 102=Fastighet, 103=Byggnad, 105=Plan, 107=Rum, etc.
  properties?: Record<string, any>;
}

/**
 * Create an object in FM Access under the given parent.
 */
export async function createFmAccessObject(payload: FmAccessCreatePayload): Promise<any> {
  const { data, error } = await supabase.functions.invoke("fm-access-query", {
    body: { action: "create-object", ...payload },
  });
  if (error) throw new Error(error.message || "Failed to create FM Access object");
  if (!data?.success) throw new Error(data?.error || "FM Access create failed");
  return data.data;
}

// ── Update operations ──────────────────────────────────────────────

export interface FmAccessUpdatePayload {
  guid: string;
  name?: string;
  properties?: Record<string, any>;
}

/**
 * Update an existing object's name or properties in FM Access.
 */
export async function updateFmAccessObject(payload: FmAccessUpdatePayload): Promise<any> {
  const { data, error } = await supabase.functions.invoke("fm-access-query", {
    body: { action: "update-object", ...payload },
  });
  if (error) throw new Error(error.message || "Failed to update FM Access object");
  if (!data?.success) throw new Error(data?.error || "FM Access update failed");
  return data.data;
}

// ── Delete operations ──────────────────────────────────────────────

/**
 * Delete an object from FM Access by GUID.
 */
export async function deleteFmAccessObject(guid: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("fm-access-query", {
    body: { action: "delete-object", guid },
  });
  if (error) throw new Error(error.message || "Failed to delete FM Access object");
  if (!data?.success) throw new Error(data?.error || "FM Access delete failed");
  return data.data;
}

// ── Smart bidirectional sync ───────────────────────────────────────

/**
 * Smart sync a local asset to FM Access.
 * - If the object exists in FM Access (by GUID), compares timestamps and syncs properties bidirectionally.
 * - If it doesn't exist, creates it.
 * 
 * @param fmGuid - The asset's FM GUID 
 * @returns Result with sync action taken
 */
export async function syncAssetWithFmAccess(fmGuid: string): Promise<{ success: boolean; error?: string; action?: string; direction?: string; pulled?: boolean }> {
  // 1. Fetch asset from local DB
  const { data: asset, error: fetchError } = await supabase
    .from("assets")
    .select("*")
    .eq("fm_guid", fmGuid)
    .maybeSingle();

  if (fetchError || !asset) {
    return { success: false, error: fetchError?.message || `Asset ${fmGuid} not found` };
  }

  // 2. Determine parent GUID (room > floor > building)
  const parentGuid = asset.in_room_fm_guid || asset.level_fm_guid || asset.building_fm_guid;

  // 3. Build properties from asset attributes
  const attrs = (asset.attributes as Record<string, any>) || {};
  const properties: Record<string, any> = {};
  
  if (asset.common_name) properties.commonName = asset.common_name;
  if (asset.asset_type) properties.assetType = asset.asset_type;
  if (attrs.designation) properties.designation = attrs.designation;
  if (attrs.description) properties.description = attrs.description;
  
  if (asset.coordinate_x != null) {
    properties.coordinateX = asset.coordinate_x;
    properties.coordinateY = asset.coordinate_y;
    properties.coordinateZ = asset.coordinate_z;
  }

  // 4. Call smart sync endpoint
  try {
    const { data, error } = await supabase.functions.invoke("fm-access-query", {
      body: { 
        action: "sync-object",
        fmGuid: asset.fm_guid,
        name: asset.name || asset.common_name || "Unnamed",
        parentGuid: parentGuid || undefined,
        properties: Object.keys(properties).length > 0 ? properties : undefined,
        localUpdatedAt: asset.updated_at,
        ifcType: asset.asset_type,     // e.g. "IfcDoor" — used for targetClass resolution
        category: asset.category,       // e.g. "Instance", "Space", "Level"
      },
    });

    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || "Sync failed", action: data?.action };

    // 5. If FM Access has newer data, update local DB
    if (data.direction === 'pull' && data.remoteProperties) {
      const remoteProps = data.remoteProperties as Record<string, any>;
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      
      if (remoteProps.commonName && remoteProps.commonName !== asset.common_name) {
        updates.common_name = remoteProps.commonName;
      }
      if (data.remoteName && data.remoteName !== asset.name) {
        updates.name = data.remoteName;
      }

      // Merge remote properties into attributes
      const mergedAttrs = { ...attrs };
      for (const [key, value] of Object.entries(remoteProps)) {
        if (key !== 'commonName' && key !== 'assetType') {
          mergedAttrs[key] = value;
        }
      }
      updates.attributes = mergedAttrs;

      await supabase.from("assets").update(updates).eq("fm_guid", fmGuid);
      return { success: true, action: 'pull', direction: 'pull', pulled: true };
    }

    return { success: true, action: data.action, direction: data.direction };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Ensure the full building hierarchy (Fastighet → Byggnad → Plan → Rum) exists in FM Access.
 * Called automatically before syncing individual assets.
 */
export async function ensureFmAccessHierarchy(buildingFmGuid: string): Promise<{ success: boolean; error?: string; action?: string; created?: string[] }> {
  try {
    // 1. Get building info from local assets
    const { data: buildingAsset } = await supabase
      .from("assets")
      .select("name, common_name, complex_common_name, building_fm_guid")
      .eq("fm_guid", buildingFmGuid)
      .maybeSingle();

    // If no building asset found, try to get building name from any asset under this building
    let buildingName = buildingAsset?.name || buildingAsset?.common_name || "Unnamed";
    let complexName = buildingAsset?.complex_common_name || buildingName;

    if (!buildingAsset) {
      const { data: anyAsset } = await supabase
        .from("assets")
        .select("complex_common_name")
        .eq("building_fm_guid", buildingFmGuid)
        .limit(1)
        .maybeSingle();
      if (anyAsset?.complex_common_name) {
        buildingName = anyAsset.complex_common_name;
        complexName = anyAsset.complex_common_name;
      }
    }

    // 2. Get levels (category = 'Level') under this building
    const { data: levelAssets } = await supabase
      .from("assets")
      .select("fm_guid, name, common_name")
      .eq("building_fm_guid", buildingFmGuid)
      .eq("category", "Level");

    const levels = (levelAssets || []).map(l => ({
      fmGuid: l.fm_guid,
      name: l.name || l.common_name || "Plan",
    }));

    // 3. Get rooms (category = 'Space') under this building
    const { data: roomAssets } = await supabase
      .from("assets")
      .select("fm_guid, name, common_name, level_fm_guid")
      .eq("building_fm_guid", buildingFmGuid)
      .eq("category", "Space");

    const rooms = (roomAssets || []).map(r => ({
      fmGuid: r.fm_guid,
      name: r.name || r.common_name || "Rum",
      levelFmGuid: r.level_fm_guid || undefined,
    }));

    console.log(`[FM Access] ensureFmAccessHierarchy: ${buildingName}, ${levels.length} levels, ${rooms.length} rooms`);

    // 4. Call ensure-hierarchy action
    const { data, error } = await supabase.functions.invoke("fm-access-query", {
      body: {
        action: "ensure-hierarchy",
        buildingFmGuid,
        buildingName,
        complexName,
        levels,
        rooms,
      },
    });

    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || "Hierarchy creation failed" };

    return { success: true, action: data.action, created: data.created };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Push a local asset from Geminus to FM Access (legacy, wraps syncAssetWithFmAccess).
 */
export async function pushAssetToFmAccess(fmGuid: string): Promise<{ success: boolean; error?: string; data?: any }> {
  return syncAssetWithFmAccess(fmGuid);
}

/**
 * Push property changes for an existing asset to FM Access.
 * Used when editing properties on objects that exist in both systems.
 */
export async function pushPropertyChangesToFmAccess(
  fmGuid: string,
  properties: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateFmAccessObject({ guid: fmGuid, properties });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Test FM Access connection.
 */
export async function testFmAccessConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke("fm-access-query", {
    body: { action: "test-connection" },
  });
  if (error) return { success: false, error: error.message };
  return { success: data?.success ?? false, message: data?.message, error: data?.error };
}
