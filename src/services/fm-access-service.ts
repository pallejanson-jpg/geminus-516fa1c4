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

// ── Push asset to FM Access ────────────────────────────────────────

/**
 * Push a local asset from Geminus to FM Access.
 * Reads asset from local DB, resolves parent hierarchy, then creates in FM Access.
 * 
 * @param fmGuid - The asset's FM GUID 
 * @returns Result with success status
 */
export async function pushAssetToFmAccess(fmGuid: string): Promise<{ success: boolean; error?: string; data?: any }> {
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
  if (!parentGuid) {
    return { success: false, error: "Asset has no parent (room/floor/building) GUID - cannot place in FM Access hierarchy" };
  }

  // 3. Build properties from asset attributes
  const attrs = (asset.attributes as Record<string, any>) || {};
  const properties: Record<string, any> = {};
  
  if (asset.common_name) properties.commonName = asset.common_name;
  if (asset.asset_type) properties.assetType = asset.asset_type;
  if (attrs.designation) properties.designation = attrs.designation;
  if (attrs.description) properties.description = attrs.description;
  
  // Add coordinates if available
  if (asset.coordinate_x != null) {
    properties.coordinateX = asset.coordinate_x;
    properties.coordinateY = asset.coordinate_y;
    properties.coordinateZ = asset.coordinate_z;
  }

  // 4. Create in FM Access
  try {
    const result = await createFmAccessObject({
      parentGuid,
      name: asset.name || asset.common_name || "Unnamed",
      properties: Object.keys(properties).length > 0 ? properties : undefined,
    });

    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
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
