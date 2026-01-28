import { supabase } from "@/integrations/supabase/client";

export type AssetPlusFilter = any[];

/**
 * Fetch assets from the local synced database for Navigator tree.
 * This reads from the `assets` table which is populated by the asset-plus-sync edge function.
 * 
 * Note: Due to Supabase's default 1000 row limit, we paginate through all results.
 */
export async function fetchLocalAssets(categories?: string[]): Promise<any[]> {
  const allAssets: any[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("assets")
      .select("fm_guid, category, name, common_name, building_fm_guid, level_fm_guid, in_room_fm_guid, complex_common_name, attributes")
      .range(offset, offset + pageSize - 1);

    if (categories && categories.length > 0) {
      query = query.in("category", categories);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to fetch local assets:", error);
      throw new Error(error.message || "Failed to fetch assets from database");
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      // Map database snake_case to camelCase for frontend compatibility
      const mapped = data.map((asset) => ({
        fmGuid: asset.fm_guid,
        category: asset.category,
        name: asset.name,
        commonName: asset.common_name,
        buildingFmGuid: asset.building_fm_guid,
        levelFmGuid: asset.level_fm_guid,
        inRoomFmGuid: asset.in_room_fm_guid,
        complexCommonName: asset.complex_common_name,
        attributes: asset.attributes,
      }));
      allAssets.push(...mapped);
      
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
      }
    }
  }

  return allAssets;
}

/**
 * Fetch a flat list of objects from Asset+ API via edge function.
 * Note: This is proxied via a backend function so we never ship secrets to the browser.
 * @deprecated Use fetchLocalAssets() for better performance with synced data.
 */
export async function fetchAssetPlusData(filter: AssetPlusFilter): Promise<any[]> {
  const { data, error } = await supabase.functions.invoke("asset-plus-query", {
    body: { filter },
  });

  if (error) {
    throw new Error(error.message || "Asset+ fetch failed");
  }

  // Expected shape: { items: [...] }
  const items = (data as any)?.items;
  if (!Array.isArray(items)) return [];
  return items;
}

// Types for Asset+ object creation
export interface AssetProperty {
  name: string;
  value: string | number | boolean;
  dataType: number; // 0=String, 1=Int32, 2=Int64, 3=Decimal, 4=DateTime, 5=Bool
}

export interface CreateAssetPayload {
  parentSpaceFmGuid: string;
  designation: string;
  commonName?: string;
  properties?: AssetProperty[];
}

/**
 * Create a new asset (ObjectType 4) in Asset+ via edge function.
 * The asset will be linked to the specified parent Space.
 */
export async function createAssetPlusObject(payload: CreateAssetPayload): Promise<any> {
  const { data, error } = await supabase.functions.invoke("asset-plus-create", {
    body: payload,
  });

  if (error) {
    throw new Error(error.message || "Failed to create asset");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Unknown error creating asset");
  }

  return data.asset;
}

/**
 * Update an existing asset in Asset+.
 * @deprecated Not yet implemented
 */
export async function updateAssetPlus(_payload: any): Promise<any> {
  throw new Error("updateAssetPlus is not implemented yet");
}

/**
 * Fetch room sensor data for a building.
 * Returns rooms with their attributes for visualization purposes.
 */
export async function fetchRoomSensorData(buildingFmGuid: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name, attributes")
    .eq("category", "Space")
    .or(`building_fm_guid.eq.${buildingFmGuid},building_fm_guid.eq.${buildingFmGuid.toLowerCase()},building_fm_guid.eq.${buildingFmGuid.toUpperCase()}`);

  if (error) {
    console.error("Failed to fetch room sensor data:", error);
    throw new Error(error.message || "Failed to fetch room sensor data");
  }

  return (data || []).map((room) => ({
    fmGuid: room.fm_guid,
    name: room.name,
    commonName: room.common_name,
    attributes: room.attributes,
  }));
}

/**
 * Check if a building has any synced assets (ObjectType 4), and if not, trigger a sync.
 * Returns true if sync was triggered, false if assets already exist.
 */
export async function syncBuildingAssetsIfNeeded(buildingFmGuid: string): Promise<{ synced: boolean; count: number }> {
  // Check local count
  const { count, error: countError } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("building_fm_guid", buildingFmGuid)
    .eq("category", "Instance");

  if (countError) {
    console.error("Failed to count assets:", countError);
    throw new Error(countError.message || "Failed to count assets");
  }

  if (count && count > 0) {
    console.log(`Building ${buildingFmGuid} already has ${count} assets`);
    return { synced: false, count };
  }

  console.log(`Building ${buildingFmGuid} has no assets, triggering sync...`);

  // Trigger sync for this building
  const { data, error } = await supabase.functions.invoke("asset-plus-sync", {
    body: { action: "sync-single-building", buildingFmGuid },
  });

  if (error) {
    console.error("Failed to sync building assets:", error);
    throw new Error(error.message || "Failed to sync building assets");
  }

  return { synced: true, count: data?.totalSynced || 0 };
}
