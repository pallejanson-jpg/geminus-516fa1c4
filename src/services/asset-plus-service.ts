import { supabase } from "@/integrations/supabase/client";

export type AssetPlusFilter = any[];

/**
 * Fetch assets from the local synced database.
 * This reads from the `assets` table which is populated by the asset-plus-sync edge function.
 */
export async function fetchLocalAssets(categories?: string[]): Promise<any[]> {
  let query = supabase
    .from("assets")
    .select("*");

  if (categories && categories.length > 0) {
    query = query.in("category", categories);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch local assets:", error);
    throw new Error(error.message || "Failed to fetch assets from database");
  }

  // Map database snake_case to camelCase for frontend compatibility
  return (data || []).map((asset) => ({
    fmGuid: asset.fm_guid,
    category: asset.category,
    name: asset.name,
    commonName: asset.common_name,
    buildingFmGuid: asset.building_fm_guid,
    levelFmGuid: asset.level_fm_guid,
    inRoomFmGuid: asset.in_room_fm_guid,
    complexCommonName: asset.complex_common_name,
    grossArea: asset.gross_area,
    assetType: asset.asset_type,
    attributes: asset.attributes,
    syncedAt: asset.synced_at,
  }));
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

// Stubs for later migration (kept for parity with Firebase project).
export async function createAssetPlusObject(_payload: any): Promise<any> {
  throw new Error("createAssetPlusObject is not implemented yet");
}

export async function updateAssetPlus(_payload: any): Promise<any> {
  throw new Error("updateAssetPlus is not implemented yet");
}
